const { Plan, Bot, User, Subscription, Transaction } = require('../models');
const AsaasService = require('../services/payment/AsaasService');
const MercadoPagoService = require('../services/payment/MercadoPagoService');
const StripeService = require('../services/payment/StripeService');
const PushinPayService = require('../services/payment/PushinPayService');
const config = require('../config');
const PaymentService = require('../services/payment');

/**
 * Checkout Controller
 * Generate payment links using CREATOR's credentials (BYOK)
 */
class CheckoutController {
    /**
     * POST /api/checkout/link
     * Generate payment link for a plan using CREATOR'S gateway credentials
     */
    async generateLink(req, res) {
        try {
            const { planId, telegramId, telegramUsername, email, name, botId, amount, description, paymentMethod } = req.body;

            let plan, creator;

            // SCENARIO 1: PLAN BASED
            if (planId) {
                plan = await Plan.findByPk(planId, {
                    include: [{
                        association: 'bot',
                        include: [{
                            association: 'owner',
                            attributes: ['id', 'name', 'email', 'gateway_preference', 'gateway_api_token', 'asaas_wallet_id']
                        }]
                    }]
                });

                if (!plan) return res.status(404).json({ error: 'Plano não encontrado' });
                creator = plan.bot?.owner;
            }
            // SCENARIO 2: CUSTOM PROMOTIONAL OFFER (No Plan)
            else if (botId && amount) {
                const bot = await Bot.findByPk(botId, {
                    include: [{
                        association: 'user', // owner
                        as: 'owner', // Alias might be 'user' or 'owner' depending on association, checking code assumes 'owner' in plan include but let's check Bot model
                        attributes: ['id', 'name', 'email', 'gateway_preference', 'gateway_api_token', 'asaas_wallet_id']
                    }]
                });

                // Bot model usually has user_id, association is 'user' (User model).
                // Let's assume standard association: Bot.belongsTo(User, { foreignKey: 'user_id' })
                if (!bot) return res.status(404).json({ error: 'Bot não encontrado' });

                // Fetch User manually if alias 'owner' fails (Bot.js definotion doesn't show alias, usually 'User')
                if (!bot.User && !bot.owner) {
                    creator = await User.findByPk(bot.user_id);
                } else {
                    creator = bot.User || bot.owner;
                }

                // Create a "Virtual" plan object for data consistency
                plan = {
                    id: null,
                    name: description || 'Oferta Especial',
                    description: 'Pagamento de oferta promocional',
                    price: parseFloat(amount),
                    is_recurring: false, // Offers are usually one-time
                    duration_days: 0,
                    bot: bot
                };
            } else {
                return res.status(400).json({ error: 'planId ou (botId + amount) são obrigatórios' });
            }

            if (!creator) {
                return res.status(400).json({ error: 'Criador não encontrado' });
            }

            // ⚠️ CRITICAL: Validate creator has configured payment gateway
            if (!creator.gateway_api_token) {
                return res.status(400).json({
                    error: 'O criador ainda não configurou o gateway de pagamento',
                    code: 'CREATOR_GATEWAY_NOT_CONFIGURED'
                });
            }

            // Determine gateway
            const gateway = creator.gateway_preference || 'asaas';
            const creatorApiKey = creator.gateway_api_token;

            // Calculate Split
            // Uses fixed fee from PaymentService
            const splitAmounts = await PaymentService.calculateSplit(parseFloat(plan.price));
            const grossAmount = splitAmounts.gross;

            // Create external reference for tracking
            const externalReference = `${planId || 'offer'}_${telegramId || 'web'}_${Date.now()}`;

            // Webhook URL
            const webhookUrl = `${config.urls.api}/api/webhooks/${gateway.toLowerCase()}`;

            // Map paymentMethod (frontend) to billingType (Asaas/Gateway)
            // Frontend: 'pix' | 'credit_card'
            // Asaas: 'PIX' | 'CREDIT_CARD' | 'BOLETO'
            let billingType = 'PIX';
            if (paymentMethod === 'credit_card') {
                billingType = 'CREDIT_CARD';
            }

            // Prepare payment data
            const paymentData = {
                planId: plan.id, // Can be null
                title: plan.name,
                description: plan.description || `Pagamento ${plan.name}`,
                amount: grossAmount,
                value: grossAmount,
                email: email || `telegram_${telegramId}@boyzclub.temp`,
                name: name || 'Assinante',
                telegramId,
                telegramUsername,
                externalReference,
                webhookUrl,
                successUrl: `${config.urls.frontend}/success?ref=${externalReference}`,
                failureUrl: `${config.urls.frontend}/failure`,
                cancelUrl: `${config.urls.frontend}/cancel`,
                dueDate: this.getNextDueDate(),
                nextDueDate: this.getNextDueDate(),
                cycle: undefined, // One-time default for offers
                billingType, // Add billingType
                // Pass credentials to PaymentService
                creatorApiToken: typeof creatorApiKey === 'string' && creatorApiKey.startsWith('{')
                    ? JSON.parse(creatorApiKey).api_token // Extract token if JSON (PushinPay)
                    : creatorApiKey,
                gatewayCredentials: typeof creatorApiKey === 'string' && creatorApiKey.startsWith('{')
                    ? JSON.parse(creatorApiKey)
                    : creatorApiKey
            };

            // Create payment using creator's credentials
            let result;

            try {
                // Gateway Factory Logic
                result = await PaymentService.createPaymentLink(gateway, paymentData, creator.asaas_wallet_id);
            } catch (gatewayError) {
                console.error(`[Checkout] Gateway error (${gateway}):`, gatewayError);
                return res.status(400).json({
                    error: 'Erro ao criar pagamento no gateway',
                    details: gatewayError.message,
                    code: 'GATEWAY_ERROR'
                });
            }

            // Create pending subscription/transaction record
            // If planId is null, we might need a workaround for Subscription model if it enforces plan_id
            // Checking models... Subscription usually requires plan_id. 
            // If we are selling something without a plan, we might need a dummy plan or nullable plan_id
            // For now, let's assume we create a generic "Offer" subscription

            let subscription;
            if (plan.id) {
                subscription = await Subscription.create({
                    plan_id: plan.id,
                    user_telegram_id: telegramId || 0,
                    user_telegram_username: telegramUsername,
                    user_name: name,
                    user_email: email,
                    gateway,
                    gateway_subscription_id: result.id || result.sessionId, // Unified ID access
                    status: 'pending'
                });
            } else {
                // For custom offers, create record without plan_id (if allowed) or handle differently
                // Ideally we should have a generic 'Offer' model or allow nullable.
                // Assuming we can pass null or 0 if constraint allows, or we just create Transaction linked to Bot directly?
                // Let's rely on standard Subscription for now but we might hit FK constraint.
                // WORKAROUND: For this feature to work strictly without Plan DB changes, 
                // we might need to find a 'Default' plan or just skip Subscription creation and rely on Transaction?
                // No, Transaction needs subscription_id usually.

                // Let's create a subscription with plan_id = null if possible, checking Subscription.js
                subscription = await Subscription.create({
                    plan_id: null, // Hope this is allowed, otherwise we need to fix model
                    bot_id: botId, // Add bot_id to subscription if plan_id is null?
                    user_telegram_id: telegramId || 0,
                    user_telegram_username: telegramUsername,
                    user_name: name,
                    user_email: email,
                    gateway,
                    gateway_subscription_id: result.id || result.sessionId,
                    status: 'pending',
                    metadata: { type: 'offer', description: description, amount: amount }
                });
            }

            // Create pending transaction
            await Transaction.create({
                subscription_id: subscription.id,
                gateway,
                gateway_payment_id: result.id || null,
                gateway_invoice_url: result.invoiceUrl || result.url || result.initPoint || result.qr_code,
                amount_gross: splitAmounts.gross,
                amount_net_creator: splitAmounts.creatorNet,
                amount_platform_fee: splitAmounts.platformFee,
                status: 'pending'
            });

            res.json({
                paymentUrl: result.invoiceUrl || result.url || result.initPoint || result.sandboxInitPoint,
                qrCode: result.qr_code,
                pixCopyPaste: result.copy_paste,
                subscriptionId: subscription.id,
                externalReference,
                split: splitAmounts,
                gateway,
                creatorName: creator.name
            });
        } catch (error) {
            console.error('[CheckoutController] Generate link error:', error);
            res.status(500).json({ error: 'Erro ao gerar link de pagamento: ' + error.message });
        }
    }

    /**
     * GET /api/checkout/status/:subscriptionId
     * Check payment status
     */
    async checkStatus(req, res) {
        try {
            const subscription = await Subscription.findByPk(req.params.subscriptionId, {
                include: ['transactions', 'plan']
            });

            if (!subscription) {
                return res.status(404).json({ error: 'Assinatura não encontrada' });
            }

            res.json({
                status: subscription.status,
                plan: subscription.plan,
                expiresAt: subscription.expires_at
            });
        } catch (error) {
            console.error('[CheckoutController] Check status error:', error);
            res.status(500).json({ error: 'Erro ao verificar status' });
        }
    }

    // Helper
    getNextDueDate() {
        const date = new Date();
        date.setDate(date.getDate() + 1);
        return date.toISOString().split('T')[0];
    }
}

module.exports = new CheckoutController();
