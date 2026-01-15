const { Subscription, Transaction, Plan } = require('../models');
const TelegramEngine = require('../services/TelegramEngine');
const AsaasService = require('../services/payment/AsaasService');
const MercadoPagoService = require('../services/payment/MercadoPagoService');
const StripeService = require('../services/payment/StripeService');
const PushinPayService = require('../services/payment/PushinPayService');
const SyncPayService = require('../services/payment/SyncPayService');
const ParadisePagService = require('../services/payment/ParadisePagService');

/**
 * Webhook Controller
 * Universal handler for all payment gateway webhooks
 */
class WebhookController {
    /**
     * POST /api/webhooks/asaas
     * Handle Asaas webhooks
     */
    async handleAsaas(req, res) {
        try {
            console.log('[Webhook] Asaas event:', JSON.stringify(req.body, null, 2));

            const event = AsaasService.parseWebhookEvent(req.body);

            if (!event.paymentId && !event.externalReference) {
                return res.sendStatus(200);
            }

            // Find transaction by payment ID
            let transaction = await Transaction.findOne({
                where: { gateway_payment_id: event.paymentId },
                include: ['subscription']
            });

            // Or find by external reference 
            if (!transaction && event.externalReference) {
                const subscription = await this.findSubscriptionByExternalRef(event.externalReference);
                if (subscription) {
                    transaction = await Transaction.findOne({
                        where: { subscription_id: subscription.id },
                        include: ['subscription']
                    });
                }
            }

            if (!transaction) {
                console.log('[Webhook] Transaction not found');
                return res.sendStatus(200);
            }

            // Process based on status
            await this.processPaymentStatus(transaction, event.status, event);

            res.sendStatus(200);
        } catch (error) {
            console.error('[Webhook] Asaas error:', error);
            res.sendStatus(500);
        }
    }

    /**
     * POST /api/webhooks/mercadopago
     * Handle Mercado Pago webhooks
     */
    async handleMercadoPago(req, res) {
        try {
            console.log('[Webhook] MercadoPago event:', JSON.stringify(req.body, null, 2));

            const event = MercadoPagoService.parseWebhookEvent(req.body);

            if (event.type !== 'payment' || !event.paymentId) {
                return res.sendStatus(200);
            }

            // Get full payment details
            const payment = await MercadoPagoService.getPayment(event.paymentId);
            const externalRef = payment.external_reference;

            const subscription = await this.findSubscriptionByExternalRef(externalRef);
            if (!subscription) {
                console.log('[Webhook] Subscription not found');
                return res.sendStatus(200);
            }

            const transaction = await Transaction.findOne({
                where: { subscription_id: subscription.id },
                include: ['subscription']
            });

            if (transaction) {
                await transaction.update({
                    gateway_payment_id: event.paymentId,
                    gateway_status: payment.status
                });

                const ourStatus = MercadoPagoService.mapStatus(payment.status);
                await this.processPaymentStatus(transaction, ourStatus === 'confirmed' ? 'CONFIRMED' : 'PENDING', {
                    paidAt: payment.date_approved
                });
            }

            res.sendStatus(200);
        } catch (error) {
            console.error('[Webhook] MercadoPago error:', error);
            res.sendStatus(500);
        }
    }

    /**
     * POST /api/webhooks/stripe
     * Handle Stripe webhooks
     */
    async handleStripe(req, res) {
        try {
            // Verify signature
            const signature = req.headers['stripe-signature'];
            const event = StripeService.verifyWebhookSignature(req.body, signature);

            if (!event) {
                return res.status(400).send('Invalid signature');
            }

            console.log('[Webhook] Stripe event:', event.type);

            const parsedEvent = StripeService.parseWebhookEvent(event);

            // Handle checkout.session.completed
            if (event.type === 'checkout.session.completed') {
                const subscription = await this.findSubscriptionByExternalRef(parsedEvent.externalReference);

                if (subscription) {
                    const transaction = await Transaction.findOne({
                        where: { subscription_id: subscription.id },
                        include: ['subscription']
                    });

                    if (transaction) {
                        await transaction.update({
                            gateway_payment_id: parsedEvent.sessionId,
                            gateway_status: 'complete'
                        });

                        await this.processPaymentStatus(transaction, 'CONFIRMED', {
                            paidAt: new Date()
                        });
                    }
                }
            }

            res.sendStatus(200);
        } catch (error) {
            console.error('[Webhook] Stripe error:', error);
            res.sendStatus(500);
        }
    }

    /**
     * POST /api/webhooks/pushinpay
     * Handle PushinPay webhooks
     * 
     * Payload: { id, value, status, description }
     */
    async handlePushinPay(req, res) {
        try {
            console.log('[Webhook] PushinPay event:', JSON.stringify(req.body, null, 2));

            // Respond immediately to PushinPay (they expect fast response)
            res.status(200).json({ received: true });

            // Process webhook payload
            const event = PushinPayService.processWebhook(req.body);

            if (!event.transactionId) {
                console.log('[Webhook] No transaction ID in PushinPay event');
                return;
            }

            // Find transaction by gateway payment ID
            const transaction = await Transaction.findOne({
                where: { gateway_payment_id: event.transactionId },
                include: ['subscription']
            });

            if (!transaction) {
                console.log('[Webhook] Transaction not found for PushinPay ID:', event.transactionId);
                return;
            }

            // Process based on status
            if (event.isPaid) {
                await this.processPaymentStatus(transaction, 'CONFIRMED', {
                    paidAt: new Date()
                });
                console.log('[Webhook] PushinPay payment confirmed:', event.transactionId);
            }
        } catch (error) {
            console.error('[Webhook] PushinPay error:', error);
            // Already responded, just log
        }
    }

    /**
     * POST /api/webhooks/telegram/:token
     * Handle Telegram updates for specific bot
     */
    async handleTelegram(req, res) {
        try {
            const { token } = req.params;
            await TelegramEngine.handleWebhook(token, req.body);
            res.sendStatus(200);
        } catch (error) {
            console.error('[Webhook] Telegram error:', error);
            res.sendStatus(200); // Always return 200 to Telegram
        }
    }

    /**
     * POST /api/webhooks/syncpay
     * Handle SyncPay webhooks
     */
    async handleSyncPay(req, res) {
        try {
            console.log('[Webhook] SyncPay event:', JSON.stringify(req.body, null, 2));

            const result = await SyncPayService.handleWebhook(req);
            res.status(200).json(result);
        } catch (error) {
            console.error('[Webhook] SyncPay error:', error);
            res.sendStatus(500);
        }
    }

    /**
     * POST /api/webhooks/paradisepag
     * Handle ParadisePag webhooks
     */
    async handleParadisePag(req, res) {
        try {
            console.log('[Webhook] ParadisePag event:', JSON.stringify(req.body, null, 2));

            const result = await ParadisePagService.handleWebhook(req);
            res.status(200).json(result);
        } catch (error) {
            console.error('[Webhook] ParadisePag error:', error);
            res.sendStatus(500);
        }
    }

    /**
     * Process payment status change
     */
    async processPaymentStatus(transaction, gatewayStatus, eventData = {}) {
        const subscription = transaction.subscription || await Subscription.findByPk(transaction.subscription_id);

        // Map gateway status to our status
        const confirmedStatuses = ['CONFIRMED', 'RECEIVED', 'PAID', 'complete', 'approved'];
        const failedStatuses = ['OVERDUE', 'FAILED', 'REFUNDED', 'CANCELLED', 'rejected'];

        let newStatus = 'pending';
        if (confirmedStatuses.includes(gatewayStatus)) {
            newStatus = 'confirmed';
        } else if (failedStatuses.includes(gatewayStatus)) {
            newStatus = 'failed';
        }

        // Update transaction
        await transaction.update({
            gateway_status: gatewayStatus,
            status: newStatus,
            paid_at: newStatus === 'confirmed' ? (eventData.paidAt || new Date()) : null
        });

        // Update subscription
        if (newStatus === 'confirmed') {
            const plan = await Plan.findByPk(subscription.plan_id);

            let expiresAt = null;
            if (plan && plan.duration_days > 0) {
                expiresAt = new Date();
                expiresAt.setDate(expiresAt.getDate() + plan.duration_days);
            }

            await subscription.update({
                status: 'active',
                starts_at: new Date(),
                expires_at: expiresAt
            });

            // Notify user via Telegram
            await TelegramEngine.notifySubscriptionActivated(subscription);

            console.log(`[Webhook] Subscription ${subscription.id} activated`);
        } else if (newStatus === 'failed') {
            await subscription.update({ status: 'failed' });
            console.log(`[Webhook] Payment failed for subscription ${subscription.id}`);
        }
    }

    /**
     * Find subscription by external reference
     */
    async findSubscriptionByExternalRef(externalRef) {
        if (!externalRef) return null;

        // External ref format: planId_telegramId_timestamp
        const parts = externalRef.split('_');
        const planId = parts[0];
        const telegramId = parts[1];

        return await Subscription.findOne({
            where: {
                plan_id: planId,
                status: 'pending'
            },
            order: [['created_at', 'DESC']]
        });
    }
}

module.exports = new WebhookController();
