const mercadopago = require('mercadopago');
const config = require('../../config');
const { Setting } = require('../../models');

/**
 * Mercado Pago Payment Service with Dynamic Credentials (BYOK)
 * 
 * IMPORTANTE: Cada criador usa sua própria conta MP!
 * - A transação é criada na conta do CRIADOR
 * - marketplace_fee envia a comissão para a PLATAFORMA
 */
class MercadoPagoService {


    /**
     * Calculate Split amounts
     */
    async calculateSplit(grossAmount) {
        let platformFee = 0.55;
        try {
            const setting = await Setting.findOne({ where: { key: 'fixed_fee_amount' } });
            if (setting) platformFee = parseFloat(setting.value);
        } catch (e) { }

        const creatorNet = Math.max(0, grossAmount - platformFee);

        return {
            gross: parseFloat(grossAmount.toFixed(2)),
            platformFee: parseFloat(platformFee.toFixed(2)),
            creatorNet: parseFloat(creatorNet.toFixed(2))
        };
    }

    /**
     * Configure SDK with creator's access token
     * @param {string} creatorAccessToken - Access token da conta MP do criador
     */
    configureWithToken(creatorAccessToken) {
        if (!creatorAccessToken) {
            throw new Error('Creator access token is required');
        }

        mercadopago.configure({
            access_token: creatorAccessToken
        });
    }

    /**
     * Create payment preference (checkout link) - Dynamic Credentials
     * 
     * FLUXO CORRETO DO MARKETPLACE:
     * 1. Configura SDK com token do CRIADOR
     * 2. Cria preferência na conta do CRIADOR
     * 3. marketplace_fee desconta a comissão da PLATAFORMA
     * 
     * @param {string} creatorAccessToken - Access token do CRIADOR
     * @param {object} paymentData - Dados do pagamento
     */
    async createPaymentPreference(creatorAccessToken, paymentData) {
        // Configura com token do criador
        this.configureWithToken(creatorAccessToken);

        const splitAmounts = await this.calculateSplit(paymentData.amount);

        try {
            const preference = {
                items: [{
                    id: paymentData.planId,
                    title: paymentData.title,
                    description: paymentData.description || '',
                    quantity: 1,
                    currency_id: 'BRL',
                    unit_price: splitAmounts.gross
                }],
                payer: {
                    email: paymentData.email,
                    name: paymentData.name
                },
                back_urls: {
                    success: paymentData.successUrl || `${config.urls.frontend}/success`,
                    failure: paymentData.failureUrl || `${config.urls.frontend}/failure`,
                    pending: paymentData.pendingUrl || `${config.urls.frontend}/pending`
                },
                auto_return: 'approved',
                external_reference: paymentData.externalReference,
                notification_url: `${config.urls.api}/api/webhooks/mercadopago`,

                // Marketplace fee - comissão que vai para a PLATAFORMA
                marketplace_fee: splitAmounts.platformFee,

                metadata: {
                    telegram_id: paymentData.telegramId,
                    plan_id: paymentData.planId
                }
            };

            const result = await mercadopago.preferences.create(preference);

            return {
                preferenceId: result.body.id,
                initPoint: result.body.init_point,
                sandboxInitPoint: result.body.sandbox_init_point,
                split: splitAmounts
            };
        } catch (error) {
            console.error('[MercadoPagoService] Error creating preference:', error);
            throw error;
        }
    }

    /**
     * Create subscription (preapproval) - Dynamic Credentials
     */
    async createSubscription(creatorAccessToken, subscriptionData) {
        this.configureWithToken(creatorAccessToken);

        const splitAmounts = await this.calculateSplit(subscriptionData.amount);

        try {
            const preapproval = {
                reason: subscriptionData.title,
                external_reference: subscriptionData.externalReference,
                payer_email: subscriptionData.email,
                auto_recurring: {
                    frequency: 1,
                    frequency_type: 'months',
                    transaction_amount: splitAmounts.gross,
                    currency_id: 'BRL',
                    start_date: new Date().toISOString(),
                    end_date: subscriptionData.endDate || null
                },
                back_url: subscriptionData.backUrl || `${config.urls.frontend}/success`,
                notification_url: `${config.urls.api}/api/webhooks/mercadopago`,
                metadata: {
                    telegram_id: subscriptionData.telegramId,
                    plan_id: subscriptionData.planId
                }
            };

            const result = await mercadopago.preapproval.create(preapproval);

            return {
                subscriptionId: result.body.id,
                initPoint: result.body.init_point,
                status: result.body.status,
                split: splitAmounts
            };
        } catch (error) {
            console.error('[MercadoPagoService] Error creating subscription:', error);
            throw error;
        }
    }

    /**
     * Get payment details
     * Note: Uses platform token for webhook verification
     */
    async getPayment(paymentId) {
        // Webhook verification can use platform token
        if (config.mercadoPago.accessToken) {
            mercadopago.configure({ access_token: config.mercadoPago.accessToken });
        }

        try {
            const result = await mercadopago.payment.get(paymentId);
            return result.body;
        } catch (error) {
            console.error('[MercadoPagoService] Error getting payment:', error);
            throw error;
        }
    }

    /**
     * Get subscription details
     */
    async getSubscription(creatorAccessToken, subscriptionId) {
        this.configureWithToken(creatorAccessToken);

        try {
            const result = await mercadopago.preapproval.get(subscriptionId);
            return result.body;
        } catch (error) {
            console.error('[MercadoPagoService] Error getting subscription:', error);
            throw error;
        }
    }

    /**
     * Cancel subscription
     */
    async cancelSubscription(creatorAccessToken, subscriptionId) {
        this.configureWithToken(creatorAccessToken);

        try {
            const result = await mercadopago.preapproval.update({
                id: subscriptionId,
                status: 'cancelled'
            });
            return result.body;
        } catch (error) {
            console.error('[MercadoPagoService] Error canceling subscription:', error);
            throw error;
        }
    }

    /**
     * Parse webhook event
     */
    parseWebhookEvent(body) {
        const { type, data, action } = body;

        return {
            type,
            action,
            paymentId: data?.id,
            externalReference: null,
            raw: body
        };
    }

    /**
     * Map MP status to our status
     */
    mapStatus(mpStatus) {
        const statusMap = {
            'approved': 'confirmed',
            'authorized': 'confirmed',
            'pending': 'pending',
            'in_process': 'pending',
            'rejected': 'failed',
            'cancelled': 'failed',
            'refunded': 'refunded'
        };
        return statusMap[mpStatus] || 'pending';
    }
}

module.exports = new MercadoPagoService();
