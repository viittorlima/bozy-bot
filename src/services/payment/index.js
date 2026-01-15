const AsaasService = require('./AsaasService');
const MercadoPagoService = require('./MercadoPagoService');
const StripeService = require('./StripeService');
const PushinPayService = require('./PushinPayService');
const SyncPayService = require('./SyncPayService');
const ParadisePagService = require('./ParadisePagService');
const config = require('../../config');
const { Setting } = require('../../models');

/**
 * Payment Gateway Factory
 * Unified interface for all payment gateways
 */
class PaymentService {
    constructor() {
        this.gateways = {
            asaas: AsaasService,
            mercadopago: MercadoPagoService,

            stripe: StripeService,
            pushinpay: PushinPayService,
            syncpay: SyncPayService,
            paradisepag: ParadisePagService
        };
    }

    /**
     * Get gateway service by name
     */
    getGateway(gatewayName) {
        const gateway = this.gateways[gatewayName?.toLowerCase()];
        if (!gateway) {
            throw new Error(`Gateway '${gatewayName}' not supported`);
        }
        return gateway;
    }

    /**
     * Get platform fixed fee
     */
    async getPlatformFee() {
        try {
            const setting = await Setting.findOne({ where: { key: 'fixed_fee_amount' } });
            return setting ? parseFloat(setting.value) : 0.55;
        } catch (e) {
            return 0.55;
        }
    }

    /**
     * Calculate Split for any gateway
     */
    async calculateSplit(amount) {
        const platformFee = await this.getPlatformFee();
        const creatorNet = Math.max(0, amount - platformFee);

        return {
            gross: parseFloat(amount.toFixed(2)),
            platformFee: parseFloat(platformFee.toFixed(2)),
            creatorNet: parseFloat(creatorNet.toFixed(2)),
            isFixedFee: true
        };
    }

    /**
     * Create payment link using the appropriate gateway
     */
    async createPaymentLink(gateway, paymentData, creatorWalletId = null) {
        const service = this.getGateway(gateway);

        switch (gateway.toLowerCase()) {
            case 'asaas':
                return await service.createPaymentWithSplit(paymentData, creatorWalletId);

            case 'mercadopago':
                return await service.createPaymentPreference(paymentData, creatorWalletId);

            case 'stripe':
                return await service.createCheckoutSession(paymentData, creatorWalletId);

            case 'pushinpay':
                return await service.createPaymentWithSplit(
                    paymentData.creatorApiToken,
                    paymentData,
                    creatorWalletId
                );

            case 'syncpay':
                return await service.createPaymentWithSplit(paymentData, creatorWalletId);

            case 'paradisepag':
                return await service.createPaymentWithSplit(paymentData, creatorWalletId);

            default:
                throw new Error(`Gateway '${gateway}' not implemented`);
        }
    }

    /**
     * Create subscription using the appropriate gateway
     */
    async createSubscription(gateway, subscriptionData, creatorWalletId = null) {
        const service = this.getGateway(gateway);

        switch (gateway.toLowerCase()) {
            case 'asaas':
                return await service.createSubscriptionWithSplit(subscriptionData, creatorWalletId);

            case 'mercadopago':
                return await service.createSubscription(subscriptionData);

            case 'stripe':
                return await service.createCheckoutSession({
                    ...subscriptionData,
                    isSubscription: true
                }, creatorWalletId);

            case 'pushinpay':
                // PushinPay não tem assinatura nativa, cria pagamento único
                return await service.createPaymentWithSplit(
                    subscriptionData.creatorApiToken,
                    subscriptionData,
                    creatorWalletId
                );

            default:
                throw new Error(`Gateway '${gateway}' not implemented`);
        }
    }

    /**
     * Cancel subscription
     */
    async cancelSubscription(gateway, subscriptionId) {
        const service = this.getGateway(gateway);
        return await service.cancelSubscription(subscriptionId);
    }

    /**
     * Get list of supported gateways
     */
    getSupportedGateways() {
        return [
            { id: 'pushinpay', name: 'PushinPay', description: 'PIX Sigiloso', recommended: true },
            { id: 'syncpay', name: 'SyncPay', description: 'PIX Automático' },
            { id: 'paradisepag', name: 'ParadisePag', description: 'Múltiplos Meios' },
            { id: 'asaas', name: 'Asaas', description: 'PIX, Boleto, Cartão' },
            { id: 'mercadopago', name: 'Mercado Pago', description: 'PIX, Cartão' },
            { id: 'stripe', name: 'Stripe', description: 'Cartão Internacional' }
        ];
    }
}

module.exports = new PaymentService();
