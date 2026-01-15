const axios = require('axios');
const config = require('../../config');
const { Setting } = require('../../models');

/**
 * Asaas Payment Service with Dynamic Credentials (BYOK - Bring Your Own Key)
 * 
 * IMPORTANTE: Cada criador usa sua própria conta Asaas!
 * - A transação é criada na conta do CRIADOR
 * - O Split envia a comissão para a PLATAFORMA
 */
class AsaasService {
    /**
     * Create axios instance with creator's API key
     * @param {string} creatorApiKey - Token de API da conta Asaas do criador
     */
    createClient(creatorApiKey) {
        if (!creatorApiKey) {
            throw new Error('Creator API key is required');
        }

        return axios.create({
            baseURL: config.asaas.apiUrl || 'https://api.asaas.com/v3',
            headers: {
                'access_token': creatorApiKey,
                'Content-Type': 'application/json'
            }
        });
    }

    /**
         * Calculate Split amounts
         * O criador recebe o NET, a plataforma recebe a FEE
         */
    async calculateSplit(grossAmount) {
        let platformFee = 0.55; // default fixed fee
        try {
            const setting = await Setting.findOne({ where: { key: 'fixed_fee_amount' } });
            if (setting) platformFee = parseFloat(setting.value);
        } catch (e) {
            console.error('Error fetching fixed fee', e);
        }

        const creatorNet = Math.max(0, grossAmount - platformFee);

        return {
            gross: parseFloat(grossAmount.toFixed(2)),
            platformFee: parseFloat(platformFee.toFixed(2)),
            creatorNet: parseFloat(creatorNet.toFixed(2))
        };
    }

    /**
     * Create or find customer
     * @param {string} creatorApiKey - API key do criador
     * @param {object} customerData - Dados do cliente
     */
    async createCustomer(creatorApiKey, customerData) {
        const client = this.createClient(creatorApiKey);

        try {
            // Check if customer exists
            const existing = await this.findCustomerByEmail(creatorApiKey, customerData.email);
            if (existing) return existing;

            const response = await client.post('/customers', {
                name: customerData.name,
                email: customerData.email,
                cpfCnpj: customerData.cpf,
                phone: customerData.phone,
                mobilePhone: customerData.phone,
                externalReference: customerData.externalReference,
                notificationDisabled: false,
                observations: customerData.observations || ''
            });

            return response.data;
        } catch (error) {
            console.error('[AsaasService] Error creating customer:', error.response?.data || error);
            throw error;
        }
    }

    /**
     * Find customer by email
     */
    async findCustomerByEmail(creatorApiKey, email) {
        const client = this.createClient(creatorApiKey);

        try {
            const response = await client.get('/customers', {
                params: { email }
            });
            return response.data.data?.[0] || null;
        } catch (error) {
            return null;
        }
    }

    /**
     * Create payment with Split - Dynamic Credentials
     * 
     * FLUXO CORRETO DO MARKETPLACE:
     * 1. Transação é criada na conta do CRIADOR (usando creatorApiKey)
     * 2. O Split envia a COMISSÃO para a conta da PLATAFORMA
     * 
     * @param {string} creatorApiKey - Token de API da conta Asaas do CRIADOR
     * @param {object} paymentData - Dados do pagamento
     */
    async createPaymentWithSplit(creatorApiKey, paymentData) {
        const client = this.createClient(creatorApiKey);
        const splitAmounts = this.calculateSplit(paymentData.value);

        try {
            // O Split envia a comissão para a carteira da PLATAFORMA
            const platformWalletId = config.asaas.platformWalletId;

            const split = [];
            if (platformWalletId) {
                split.push({
                    walletId: platformWalletId,
                    fixedValue: splitAmounts.platformFee // Plataforma recebe a taxa
                });
            } else {
                console.warn('[AsaasService] PLATFORM_WALLET_ID not configured! Split disabled.');
            }

            const payload = {
                customer: paymentData.customerId,
                billingType: paymentData.billingType || 'PIX', // PIX, BOLETO, CREDIT_CARD
                value: splitAmounts.gross,
                dueDate: paymentData.dueDate || this.getNextDueDate(),
                description: paymentData.description,
                externalReference: paymentData.externalReference,

                // Split: envia comissão para plataforma
                split: split.length > 0 ? split : undefined,

                // Callback
                callback: {
                    successUrl: paymentData.successUrl,
                    autoRedirect: true
                }
            };

            // Pro assinaturas
            if (paymentData.cycle) {
                payload.cycle = paymentData.cycle;
            }

            const response = await client.post('/payments', payload);

            return {
                payment: response.data,
                split: splitAmounts,
                invoiceUrl: response.data.invoiceUrl,
                bankSlipUrl: response.data.bankSlipUrl,
                pixQrCode: response.data.pixQrCodeBase64,
                pixCopyPaste: response.data.pixCopia
            };
        } catch (error) {
            console.error('[AsaasService] Error creating payment:', error.response?.data || error);
            throw error;
        }
    }

    /**
     * Create subscription with Split - Dynamic Credentials
     */
    async createSubscriptionWithSplit(creatorApiKey, subscriptionData) {
        const client = this.createClient(creatorApiKey);
        const splitAmounts = this.calculateSplit(subscriptionData.value);

        try {
            const platformWalletId = config.asaas.platformWalletId;

            const split = [];
            if (platformWalletId) {
                split.push({
                    walletId: platformWalletId,
                    fixedValue: splitAmounts.platformFee
                });
            }

            const payload = {
                customer: subscriptionData.customerId,
                billingType: subscriptionData.billingType || 'UNDEFINED',
                value: splitAmounts.gross,
                nextDueDate: subscriptionData.nextDueDate || this.getNextDueDate(),
                cycle: subscriptionData.cycle || 'MONTHLY',
                description: subscriptionData.description,
                externalReference: subscriptionData.externalReference,
                split: split.length > 0 ? split : undefined
            };

            const response = await client.post('/subscriptions', payload);

            // Get invoice URL
            let invoiceUrl = null;
            try {
                const invoices = await client.get(`/subscriptions/${response.data.id}/invoices`);
                if (invoices.data.data?.[0]) {
                    invoiceUrl = invoices.data.data[0].invoiceUrl;
                }
            } catch (e) {
                // Invoice not yet generated
            }

            return {
                subscription: response.data,
                split: splitAmounts,
                invoiceUrl
            };
        } catch (error) {
            console.error('[AsaasService] Error creating subscription:', error.response?.data || error);
            throw error;
        }
    }

    /**
     * Get PIX QR Code
     */
    async getPixQrCode(creatorApiKey, paymentId) {
        const client = this.createClient(creatorApiKey);

        try {
            const response = await client.get(`/payments/${paymentId}/pixQrCode`);
            return response.data;
        } catch (error) {
            console.error('[AsaasService] Error getting PIX QR:', error.response?.data || error);
            throw error;
        }
    }

    /**
     * Get payment status
     */
    async getPayment(creatorApiKey, paymentId) {
        const client = this.createClient(creatorApiKey);

        try {
            const response = await client.get(`/payments/${paymentId}`);
            return response.data;
        } catch (error) {
            console.error('[AsaasService] Error getting payment:', error.response?.data || error);
            throw error;
        }
    }

    /**
     * Cancel subscription
     */
    async cancelSubscription(creatorApiKey, subscriptionId) {
        const client = this.createClient(creatorApiKey);

        try {
            const response = await client.delete(`/subscriptions/${subscriptionId}`);
            return response.data;
        } catch (error) {
            console.error('[AsaasService] Error canceling subscription:', error.response?.data || error);
            throw error;
        }
    }

    /**
     * Parse webhook event
     */
    parseWebhookEvent(body) {
        const { event, payment, subscription } = body;

        return {
            event,
            paymentId: payment?.id,
            subscriptionId: subscription?.id || payment?.subscription,
            externalReference: payment?.externalReference,
            status: payment?.status,
            value: payment?.value,
            paidAt: payment?.confirmedDate || payment?.paymentDate,
            billingType: payment?.billingType
        };
    }

    // Helpers
    getNextDueDate() {
        const date = new Date();
        date.setDate(date.getDate() + 1);
        return date.toISOString().split('T')[0];
    }
}

module.exports = new AsaasService();
