const axios = require('axios');
const { Subscription, Plan, Bot, Transaction, Setting } = require('../../models');
const config = require('../../config');
const TelegramEngine = require('../TelegramEngine');

/**
 * ParadisePag Service
 * Implementation of ParadisePag with Fixed Fee
 */
class ParadisePagService {
    /**
     * Get API credentials from DB
     */
    async getCredentials() {
        try {
            const publicKey = await Setting.findOne({ where: { key: 'paradisepag_public_key' } });
            const secretKey = await Setting.findOne({ where: { key: 'paradisepag_secret_key' } });

            if (!publicKey?.value || !secretKey?.value) return null;

            return {
                public_key: publicKey.value,
                secret_key: secretKey.value
            };
        } catch (e) {
            console.error('[ParadisePag] Error getting credentials:', e);
            return null;
        }
    }

    /**
     * Calculate Split
     */
    async calculateSplit(grossAmount) {
        const PaymentService = require('./index');
        return await PaymentService.calculateSplit(grossAmount);
    }

    /**
     * Create Payment
     */
    async createPaymentWithSplit(paymentData, creatorWalletId) {
        const credentials = await this.getCredentials();
        if (!credentials) throw new Error('ParadisePag credentials not configured');

        const split = await this.calculateSplit(paymentData.amount);

        // Based on docs found in search: initiates payment with amount, ipn_url, etc.
        const payload = {
            amount: split.gross,
            currency: 'BRL',
            description: paymentData.description,
            customer_name: paymentData.customer.name,
            customer_email: paymentData.customer.email,
            ipn_url: `${config.urls.api}/webhooks/paradisepag`,
            success_url: config.urls.frontend, // or specific success page
            cancel_url: config.urls.frontend,
            site_logo: 'https://boyzclub.com/logo.png', // valid logo URL
            // Custom data for split (assuming metadata or specific field support)
            metadata: {
                split_rules: JSON.stringify([
                    { recipient: 'platform', amount: split.platformFee },
                    { recipient: creatorWalletId, amount: split.creatorNet }
                ])
            }
        };

        try {
            // Mock API call
            // const response = await axios.post('https://api.paradise-pay.com/initiate-payment', payload, {
            //     headers: { 
            //         'Public-Key': credentials.public_key,
            //         'Secret-Key': credentials.secret_key
            //     }
            // });

            const response = {
                data: {
                    transaction_id: `paradise_${Date.now()}`,
                    payment_url: `https://paradise-pay.com/pay/mock_${Date.now()}`,
                    qr_code: '00020126580014br.gov.bcb.pix0136123e4567-e89b-12d3-a456-426614174000520400005303986540510.005802BR5913Paradise6008Brasilia62070503***6304E2CA',
                    copy_paste: '00020126580014br.gov.bcb.pix0136123e4567-e89b-12d3-a456-426614174000520400005303986540510.005802BR5913Paradise6008Brasilia62070503***6304E2CA'
                }
            };

            return {
                id: response.data.transaction_id,
                gateway: 'paradisepag',
                status: 'pending',
                qr_code: response.data.qr_code,
                copy_paste: response.data.copy_paste,
                url: response.data.payment_url,
                amount: split.gross,
                split
            };

        } catch (error) {
            console.error('[ParadisePag] Error creating payment:', error.response?.data || error.message);
            throw new Error('Erro ao criar pagamento ParadisePag');
        }
    }

    /**
     * Webhook Handler
     */
    async handleWebhook(req) {
        // ParadisePag sends success status
        const { transaction_id, status } = req.body;

        if (status === 'success' || status === 'paid') {
            const transaction = await Transaction.findOne({ where: { gateway_id: transaction_id } });
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

module.exports = new ParadisePagService();
