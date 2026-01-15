const Stripe = require('stripe');
const config = require('../../config');
const { Setting } = require('../../models');

/**
 * Stripe Payment Service with Dynamic Credentials (BYOK)
 * 
 * Para Stripe, o modelo é diferente:
 * - Criador precisa ter Stripe Connect configurado
 * - Usamos o stripe_account_id do criador para Direct Charges
 * - application_fee_amount vai para a conta da plataforma
 */
class StripeService {
    constructor() {
        // Platform Stripe instance (for creating connected accounts, etc)
        this.stripe = null;
        if (config.stripe.secretKey) {
            this.stripe = Stripe(config.stripe.secretKey);
        }
    }

    /**
     * Calculate Split amounts
     */
    async calculateSplit(grossAmount) {
        let platformFee = 0.55;
        try {
            const setting = await Setting.findOne({ where: { key: 'fixed_fee_amount' } });
            if (setting) platformFee = parseFloat(setting.value);
        } catch (e) { console.error(e); }

        // Stripe requires amounts in cents
        // We ensure platformFee is at least something if needed, but fixed fee is fixed.

        const creatorNet = Math.max(0, grossAmount - platformFee);

        return {
            gross: parseFloat(grossAmount.toFixed(2)),
            platformFee: parseFloat(platformFee.toFixed(2)),
            creatorNet: parseFloat(creatorNet.toFixed(2)),
            grossCents: Math.round(grossAmount * 100),
            platformFeeCents: Math.round(platformFee * 100)
        };
    }

    /**
     * Create Connected Account for creator
     * Chamado quando criador configura Stripe pela primeira vez
     */
    async createConnectedAccount(creatorData) {
        if (!this.stripe) throw new Error('Stripe not configured');

        try {
            const account = await this.stripe.accounts.create({
                type: 'express',
                country: 'BR',
                email: creatorData.email,
                capabilities: {
                    card_payments: { requested: true },
                    transfers: { requested: true }
                },
                business_type: 'individual',
                metadata: {
                    user_id: creatorData.userId
                }
            });

            // Create onboarding link
            const accountLink = await this.stripe.accountLinks.create({
                account: account.id,
                refresh_url: `${config.urls.frontend}/dashboard/finance?refresh=true`,
                return_url: `${config.urls.frontend}/dashboard/finance?success=true`,
                type: 'account_onboarding'
            });

            return {
                accountId: account.id,
                onboardingUrl: accountLink.url
            };
        } catch (error) {
            console.error('[StripeService] Error creating connected account:', error);
            throw error;
        }
    }

    /**
     * Create Checkout Session with Split - Dynamic Credentials
     * 
     * FLUXO CORRETO:
     * - Usa Destination Charges: pagamento vai para conta conectada do criador
     * - application_fee_amount = comissão da plataforma
     * 
     * @param {string} creatorStripeAccountId - ID da conta conectada do criador (acct_xxx)
     * @param {object} sessionData - Dados da sessão
     */
    async createCheckoutSession(creatorStripeAccountId, sessionData) {
        if (!this.stripe) throw new Error('Stripe not configured');
        if (!creatorStripeAccountId) throw new Error('Creator Stripe account ID is required');

        try {
            const splitAmounts = await this.calculateSplit(sessionData.amount);

            const sessionParams = {
                mode: sessionData.isSubscription ? 'subscription' : 'payment',
                line_items: [{
                    price_data: {
                        currency: 'brl',
                        product_data: {
                            name: sessionData.title,
                            description: sessionData.description
                        },
                        unit_amount: splitAmounts.grossCents,
                        ...(sessionData.isSubscription && {
                            recurring: {
                                interval: 'month',
                                interval_count: 1
                            }
                        })
                    },
                    quantity: 1
                }],
                success_url: sessionData.successUrl || `${config.urls.frontend}/success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: sessionData.cancelUrl || `${config.urls.frontend}/cancel`,
                customer_email: sessionData.email,
                metadata: {
                    telegram_id: sessionData.telegramId?.toString(),
                    plan_id: sessionData.planId,
                    external_reference: sessionData.externalReference
                },

                // Destination Charges - pagamento vai para criador
                payment_intent_data: {
                    application_fee_amount: splitAmounts.platformFeeCents, // Plataforma recebe isso
                    transfer_data: {
                        destination: creatorStripeAccountId // Criador recebe o resto
                    }
                }
            };

            const session = await this.stripe.checkout.sessions.create(sessionParams);

            return {
                sessionId: session.id,
                url: session.url,
                split: splitAmounts
            };
        } catch (error) {
            console.error('[StripeService] Error creating checkout session:', error);
            throw error;
        }
    }

    /**
     * Cancel subscription
     */
    async cancelSubscription(subscriptionId) {
        if (!this.stripe) throw new Error('Stripe not configured');

        try {
            return await this.stripe.subscriptions.cancel(subscriptionId);
        } catch (error) {
            console.error('[StripeService] Error canceling subscription:', error);
            throw error;
        }
    }

    /**
     * Verify webhook signature
     */
    verifyWebhookSignature(payload, signature) {
        if (!this.stripe || !config.stripe.webhookSecret) return null;

        try {
            return this.stripe.webhooks.constructEvent(
                payload,
                signature,
                config.stripe.webhookSecret
            );
        } catch (error) {
            console.error('[StripeService] Webhook signature verification failed:', error);
            return null;
        }
    }

    /**
     * Parse webhook event
     */
    parseWebhookEvent(event) {
        const obj = event.data.object;

        return {
            type: event.type,
            sessionId: obj.id,
            subscriptionId: obj.subscription,
            customerId: obj.customer,
            externalReference: obj.metadata?.external_reference,
            telegramId: obj.metadata?.telegram_id,
            planId: obj.metadata?.plan_id,
            status: obj.status,
            amountTotal: obj.amount_total ? obj.amount_total / 100 : null
        };
    }

    /**
     * Map Stripe status to our status
     */
    mapStatus(stripeStatus) {
        const statusMap = {
            'complete': 'confirmed',
            'paid': 'confirmed',
            'active': 'confirmed',
            'open': 'pending',
            'incomplete': 'pending',
            'canceled': 'failed',
            'unpaid': 'failed'
        };
        return statusMap[stripeStatus] || 'pending';
    }
}

module.exports = new StripeService();
