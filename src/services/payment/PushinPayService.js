const axios = require('axios');
const config = require('../../config');
const { Setting } = require('../../models');

/**
 * PushinPay Payment Service
 * 
 * Gateway focado em PIX, sigiloso e sem burocracia.
 * Documentação: https://doc.pushinpay.com.br/
 * 
 * IMPORTANTE: Cada criador usa seu próprio token PushinPay!
 * - A transação é criada na conta do CRIADOR
 * - O Split envia a comissão para a PLATAFORMA
 */
class PushinPayService {
    /**
     * Create axios instance with creator's API token
     * @param {string} apiToken - Token de API da conta PushinPay do criador
     */
    createClient(apiToken) {
        if (!apiToken) {
            throw new Error('PushinPay API token is required');
        }

        return axios.create({
            baseURL: 'https://api.pushinpay.com.br',
            headers: {
                'Authorization': `Bearer ${apiToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });
    }



    /**
     * Calculate Split amounts
     * O criador recebe o NET, a plataforma recebe a FEE
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
            creatorNet: parseFloat(creatorNet.toFixed(2)),
            isFixedFee: true
        };
    }

    /**
     * Create PIX payment (cashIn) with split
     * 
     * @param {string} creatorApiToken - Token de API do criador
     * @param {object} paymentData - Dados do pagamento
     * @param {string} platformAccountId - ID da conta da plataforma para split (opcional)
     * @param {string} webhookUrl - URL para receber notificações
     */
    async createPixPayment(creatorApiToken, paymentData, platformAccountId = null, webhookUrl = null) {
        const client = this.createClient(creatorApiToken);

        try {
            // Valor em centavos!
            const valueInCents = Math.round(paymentData.amount * 100);
            const split = await this.calculateSplit(paymentData.amount);

            const payload = {
                value: valueInCents,
                webhook_url: webhookUrl || paymentData.webhookUrl
            };

            // Se tiver split configurado para a plataforma
            if (platformAccountId) {
                const platformFeeInCents = Math.round(split.platformFee * 100);
                payload.split_rules = [
                    {
                        value: platformFeeInCents,
                        account_id: platformAccountId
                    }
                ];
            }

            console.log('[PushinPayService] Creating PIX payment:', {
                value: valueInCents,
                webhook: payload.webhook_url,
                hasSplit: !!platformAccountId
            });

            const response = await client.post('/api/pix/cashIn', payload);

            const result = {
                id: response.data.id,
                status: response.data.status,
                qrCode: response.data.qr_code,
                qrCodeBase64: response.data.qr_code_base64,
                value: response.data.value,
                // Dados do split
                split,
                // URL de pagamento (usar QR code)
                paymentUrl: null,
                paymentMethod: 'pix'
            };

            console.log('[PushinPayService] Payment created:', result.id);
            return result;

        } catch (error) {
            console.error('[PushinPayService] Error creating payment:', error.response?.data || error.message);
            throw this.handleError(error);
        }
    }

    /**
     * Create payment with split (interface unificada)
     */
    async createPaymentWithSplit(creatorApiToken, paymentData, platformAccountId = null) {
        return this.createPixPayment(creatorApiToken, paymentData, platformAccountId, paymentData.webhookUrl);
    }

    /**
     * Get transaction status
     */
    async getTransactionStatus(creatorApiToken, transactionId) {
        const client = this.createClient(creatorApiToken);

        try {
            const response = await client.get(`/api/transactions/${transactionId}`);

            return {
                id: response.data.id,
                status: response.data.status,
                value: response.data.value,
                paymentType: response.data.payment_type,
                createdAt: response.data.created_at,
                updatedAt: response.data.updated_at,
                pixDetails: response.data.pix_details
            };
        } catch (error) {
            console.error('[PushinPayService] Error getting transaction:', error.response?.data || error.message);
            throw this.handleError(error);
        }
    }

    /**
     * Refund transaction (estorno)
     * ATENÇÃO: Prazo máximo de 30 dias!
     */
    async refundTransaction(creatorApiToken, transactionId) {
        const client = this.createClient(creatorApiToken);

        try {
            const response = await client.post(`/api/transactions/${transactionId}/refund`);

            console.log('[PushinPayService] Refund successful:', transactionId);
            return response.data;
        } catch (error) {
            console.error('[PushinPayService] Error refunding:', error.response?.data || error.message);
            throw this.handleError(error);
        }
    }

    /**
     * Process webhook payload
     * 
     * Webhook payload structure:
     * {
     *   "id": "fb88a89d012f45eea86cff9a86ea81e6",
     *   "value": 22,  // em centavos ou reais dependendo do contexto
     *   "status": "paid",
     *   "description": "Transação PIX enviada para..."
     * }
     */
    processWebhook(payload) {
        return {
            transactionId: payload.id,
            status: payload.status,
            value: typeof payload.value === 'number' ? payload.value / 100 : parseFloat(payload.value), // Normalizar para reais
            description: payload.description,
            isPaid: payload.status === 'paid',
            rawPayload: payload
        };
    }

    /**
     * Validate if credentials are valid
     */
    async validateCredentials(apiToken) {
        try {
            // Tenta criar uma cobrança mínima para testar
            // Na prática, PushinPay não tem endpoint de validação, então fazemos um GET
            const client = this.createClient(apiToken);

            // Tentar pegar transações (vai retornar lista vazia se não tiver)
            await client.get('/api/transactions', { params: { limit: 1 } });

            return { valid: true };
        } catch (error) {
            return {
                valid: false,
                error: error.response?.status === 401 ? 'Token inválido' : 'Erro ao validar token'
            };
        }
    }

    /**
     * Handle errors with proper messages
     */
    handleError(error) {
        if (error.response) {
            const { status, data } = error.response;

            switch (status) {
                case 400:
                    return new Error(`Dados inválidos: ${JSON.stringify(data)}`);
                case 401:
                    return new Error('Token de API inválido ou expirado');
                case 404:
                    return new Error('Transação não encontrada');
                case 500:
                    return new Error('Erro no servidor PushinPay. Tente novamente.');
                default:
                    return new Error(`Erro PushinPay: ${status} - ${JSON.stringify(data)}`);
            }
        }

        return new Error(`Erro de conexão: ${error.message}`);
    }
}

module.exports = new PushinPayService();
