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
            const { planId, telegramId, telegramUsername, email, name } = req.body;

            if (!planId) {
                return res.status(400).json({ error: 'planId é obrigatório' });
            }

            // Get plan with bot and owner (creator)
            const plan = await Plan.findByPk(planId, {
                include: [{
                    association: 'bot',
                    include: [{
                        association: 'owner',
                        attributes: ['id', 'name', 'email', 'gateway_preference', 'gateway_api_token', 'asaas_wallet_id']
                    }]
                }]
            });

            if (!plan) {
                return res.status(404).json({ error: 'Plano não encontrado' });
            }

            const creator = plan.bot?.owner;
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
            const externalReference = `${plan.id}_${telegramId || 'web'}_${Date.now()}`;

            // Webhook URL
            const webhookUrl = `${config.urls.api}/api/webhooks/${gateway.toLowerCase()}`;

            // Prepare payment data
            const paymentData = {
                planId: plan.id,
                title: plan.name,
                description: plan.description || `Assinatura ${plan.name}`,
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
                cycle: plan.is_recurring ? 'MONTHLY' : undefined
            };

            // Create payment using creator's credentials
            let result;

            try {
                switch (gateway.toLowerCase()) {
                    case 'asaas':
                        // First, create/get customer in creator's Asaas account
                        const customer = await AsaasService.createCustomer(creatorApiKey, {
                            name: name || `Telegram ${telegramId}`,
                            email: paymentData.email,
                            externalReference: telegramId?.toString()
                        });
                        paymentData.customerId = customer.id;

                        // Create payment with Split (commission goes to platform)
                        if (plan.is_recurring && plan.duration_days > 0) {
                            result = await AsaasService.createSubscriptionWithSplit(creatorApiKey, paymentData);
                        } else {
                            result = await AsaasService.createPaymentWithSplit(creatorApiKey, paymentData);
                        }
                        break;

                    case 'mercadopago':
                        result = await MercadoPagoService.createPaymentPreference(creatorApiKey, paymentData);
                        break;

                    case 'stripe':
                        // For Stripe, creatorApiKey should be the connected account ID (acct_xxx)
                        result = await StripeService.createCheckoutSession(creatorApiKey, {
                            ...paymentData,
                            isSubscription: plan.is_recurring && plan.duration_days > 0
                        });
                        break;

                    case 'pushinpay':
                        // PushinPay - PIX only
                        result = await PushinPayService.createPixPayment(
                            creatorApiKey,
                            paymentData,
                            config.pushinpay?.platformAccountId, // ID da conta da plataforma para split
                            webhookUrl
                        );
                        break;

                    default:
                        return res.status(400).json({ error: `Gateway '${gateway}' não suportado` });
                }
            } catch (gatewayError) {
                console.error(`[Checkout] Gateway error (${gateway}):`, gatewayError);
                return res.status(400).json({
                    error: 'Erro ao criar pagamento no gateway',
                    details: gatewayError.message,
                    code: 'GATEWAY_ERROR'
                });
            }

            // Create pending subscription record
            const subscription = await Subscription.create({
                plan_id: plan.id,
                user_telegram_id: telegramId || 0,
                user_telegram_username: telegramUsername,
                user_name: name,
                user_email: email,
                gateway,
                gateway_subscription_id: result.subscription?.id || result.sessionId || result.preferenceId,
                status: 'pending'
            });

            // Create pending transaction
            await Transaction.create({
                subscription_id: subscription.id,
                gateway,
                gateway_payment_id: result.payment?.id || null,
                gateway_invoice_url: result.invoiceUrl || result.url || result.initPoint,
                amount_gross: splitAmounts.gross,
                amount_net_creator: splitAmounts.creatorNet,
                amount_platform_fee: splitAmounts.platformFee,
                status: 'pending'
            });

            // Return payment URL
            const paymentUrl = result.invoiceUrl || result.url || result.initPoint || result.sandboxInitPoint;

            res.json({
                paymentUrl,
                subscriptionId: subscription.id,
                externalReference,
                split: splitAmounts,
                gateway,
                creatorName: creator.name
            });
        } catch (error) {
            console.error('[CheckoutController] Generate link error:', error);
            res.status(500).json({ error: 'Erro ao gerar link de pagamento' });
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
