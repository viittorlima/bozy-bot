const axios = require('axios');
const { Subscription, Plan, Bot, Transaction, Setting } = require('../../models');
const config = require('../../config');
const TelegramEngine = require('../TelegramEngine');

/**
 * Sync Pay Service
 * Implementation of Sync Pay PIX with Fixed Fee
 */
class SyncPayService {
    /**
     * Get API credentials from DB
     */
    async getCredentials() {
        try {
            const apiKey = await Setting.findOne({ where: { key: 'syncpay_api_key' } });
            const platformRecipientId = await Setting.findOne({ where: { key: 'syncpay_platform_recipient_id' } });
            const defaultRecipientId = await Setting.findOne({ where: { key: 'syncpay_default_recipient_id' } });

            if (!apiKey?.value) return null;

            return {
                apiKey: apiKey.value,
                platform_recipient_id: platformRecipientId?.value || '',
                default_recipient_id: defaultRecipientId?.value || ''
            };
        } catch (e) {
            console.error('[SyncPay] Error getting credentials:', e);
            return null;
        }
    }

    /**
     * Calculate Split
     */
    async calculateSplit(grossAmount) {
        // Use central PaymentService logic, but we can implement specific adjustments if needed
        // For now, re-implement to avoid circular deps if PaymentService requires this
        // But better to use the one passed or import PaymentService static helper?
        // Let's replicate logic or import
        const PaymentService = require('./index');
        return await PaymentService.calculateSplit(grossAmount);
    }

    /**
     * Create Payment (Pix)
     */
    async createPaymentWithSplit(paymentData, creatorWalletId) {
        const credentials = await this.getCredentials();
        if (!credentials) throw new Error('SyncPay credentials not configured');

        const split = await this.calculateSplit(paymentData.amount);

        // Construct payload based on generic PIX structure
        // Since docs are missing, assuming standard structure
        const payload = {
            amount: split.gross,
            description: paymentData.description,
            payer: {
                name: paymentData.customer.name,
                email: paymentData.customer.email,
                cpf: paymentData.customer.cpf
            },
            split: [
                {
                    recipient_id: credentials.platform_recipient_id, // Platform ID
                    amount: split.platformFee,
                    fee_payer: true
                },
                {
                    recipient_id: creatorWalletId || credentials.default_recipient_id, // Creator ID
                    amount: split.creatorNet,
                    fee_payer: false
                }
            ],
            callback_url: `${config.urls.api}/webhooks/syncpay`
        };

        try {
            // Mock call for now as we don't have real endpoint
            // const response = await axios.post('https://api.syncpay.com.br/v1/pix', payload, {
            //     headers: { Authorization: `Bearer ${credentials.apiKey}` }
            // });

            // Mock response
            const response = {
                data: {
                    id: `sync_${Date.now()}`,
                    status: 'pending',
                    pix_qr_code: '00020126580014br.gov.bcb.pix0136123e4567-e89b-12d3-a456-426614174000520400005303986540510.005802BR5913SyncPay6008Brasilia62070503***6304E2CA',
                    pix_copy_paste: '00020126580014br.gov.bcb.pix0136123e4567-e89b-12d3-a456-426614174000520400005303986540510.005802BR5913SyncPay6008Brasilia62070503***6304E2CA'
                }
            };

            return {
                id: response.data.id,
                gateway: 'syncpay',
                status: 'pending',
                qr_code: response.data.pix_qr_code,
                copy_paste: response.data.pix_copy_paste,
                amount: split.gross,
                split
            };

        } catch (error) {
            console.error('[SyncPay] Error creating payment:', error.response?.data || error.message);
            throw new Error('Erro ao criar pagamento SyncPay');
        }
    }

    /**
     * Webhook Handler
     */
    async handleWebhook(req) {
        const { id, status } = req.body;
        // Verify signature if possible

        if (status === 'paid' || status === 'approved') {
            const transaction = await Transaction.findOne({ where: { gateway_id: id } });
            if (transaction && transaction.status === 'pending') {
                await transaction.update({
                    status: 'confirmed',
                    paid_at: new Date()
                });

                // Activate Subscription
                const subscription = await Subscription.findByPk(transaction.subscription_id);
                if (subscription) {
                    await subscription.activate();
                    await TelegramEngine.notifySubscriptionActivated(subscription);
                }
            }
        }
        return { received: true };
    }
}

module.exports = new SyncPayService();
