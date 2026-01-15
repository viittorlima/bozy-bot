const jwt = require('jsonwebtoken');
const { User } = require('../models');
const config = require('../config');

/**
 * Authentication Controller
 */
class AuthController {
    /**
     * POST /api/auth/register
     * Register new creator
     */
    async register(req, res) {
        try {
            const { name, email, password, pixKey } = req.body;

            // Check if email exists
            const existing = await User.findOne({ where: { email } });
            if (existing) {
                return res.status(400).json({ error: 'Email já cadastrado' });
            }

            // Create user
            const user = await User.create({
                name,
                email,
                password_hash: password,
                pix_key: pixKey,
                role: 'creator',
                webhook_url: null // Will be generated after creation
            });

            // Generate webhook URL
            const webhookUrl = `${config.urls.api}/api/webhooks/creator/${user.id}`;
            await user.update({ webhook_url: webhookUrl });

            // Generate JWT
            const token = jwt.sign(
                { userId: user.id, role: user.role },
                config.jwt.secret,
                { expiresIn: config.jwt.expiresIn }
            );

            res.status(201).json({
                message: 'Conta criada com sucesso',
                user: user.toJSON(),
                token
            });
        } catch (error) {
            console.error('[AuthController] Register error:', error);
            res.status(500).json({ error: 'Erro ao criar conta' });
        }
    }

    /**
     * POST /api/auth/login
     * Login user
     */
    async login(req, res) {
        try {
            const { email, password } = req.body;

            // Find user
            const user = await User.findOne({ where: { email } });
            if (!user) {
                return res.status(401).json({ error: 'Email ou senha incorretos' });
            }

            // Validate password
            const isValid = await user.validatePassword(password);
            if (!isValid) {
                return res.status(401).json({ error: 'Email ou senha incorretos' });
            }

            // Check if banned
            if (user.status === 'banned') {
                return res.status(403).json({ error: 'Conta suspensa' });
            }

            // Generate JWT
            const token = jwt.sign(
                { userId: user.id, role: user.role },
                config.jwt.secret,
                { expiresIn: config.jwt.expiresIn }
            );

            res.json({
                user: user.toJSON(),
                token
            });
        } catch (error) {
            console.error('[AuthController] Login error:', error);
            res.status(500).json({ error: 'Erro ao fazer login' });
        }
    }

    /**
     * GET /api/auth/me
     * Get current user
     */
    async me(req, res) {
        try {
            const user = await User.findByPk(req.userId, {
                attributes: { include: ['gateway_preference', 'gateway_api_token'] }, // Ensure these are fetched
                include: [{
                    association: 'bots',
                    include: ['plans']
                }]
            });

            if (!user) {
                return res.status(404).json({ error: 'Usuário não encontrado' });
            }

            res.json({ user: user.toJSON() });
        } catch (error) {
            console.error('[AuthController] Me error:', error);
            res.status(500).json({ error: 'Erro ao buscar usuário' });
        }
    }

    /**
     * PUT /api/auth/gateway
     * Update gateway configuration
     */
    async updateGateway(req, res) {
        try {
            const { gateway, apiToken } = req.body;

            const user = await User.findByPk(req.userId);
            if (!user) {
                return res.status(404).json({ error: 'Usuário não encontrado' });
            }

            await user.update({
                gateway_preference: gateway,
                gateway_api_token: typeof apiToken === 'object' ? JSON.stringify(apiToken) : apiToken
            });

            res.json({
                message: 'Gateway atualizado com sucesso',
                gateway: user.gateway_preference
            });
        } catch (error) {
            console.error('[AuthController] Update gateway error:', error);
            res.status(500).json({ error: 'Erro ao atualizar gateway' });
        }
    }

    /**
     * POST /api/auth/complete-onboarding
     * Complete onboarding with fee type selection
     */
    async completeOnboarding(req, res) {
        try {
            const { feeType } = req.body; // 'standard' (5%) or 'promotion' (10%)

            const user = await User.findByPk(req.userId);
            if (!user) {
                return res.status(404).json({ error: 'Usuário não encontrado' });
            }

            const isPromotion = feeType === 'promotion';
            const now = new Date();

            // Set next month reset for promotions counter
            const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

            await user.update({
                onboarding_completed: true,
                terms_accepted_at: now,
                fee_type: isPromotion ? 'promotion' : 'standard',
                fee_rate: isPromotion ? 10.00 : 5.00,
                promotion_active: isPromotion,
                promotion_started_at: isPromotion ? now : null,
                promotions_used_this_month: 0,
                promotions_reset_at: nextMonth
            });

            res.json({
                message: 'Onboarding concluído com sucesso!',
                feeType: user.fee_type,
                feeRate: user.fee_rate,
                promotionActive: user.promotion_active
            });
        } catch (error) {
            console.error('[AuthController] Complete onboarding error:', error);
            res.status(500).json({ error: 'Erro ao completar onboarding' });
        }
    }

    /**
     * POST /api/auth/activate-promotion
     * Activate promotion (10% fee with divulgation benefits)
     */
    async activatePromotion(req, res) {
        try {
            const user = await User.findByPk(req.userId);
            if (!user) {
                return res.status(404).json({ error: 'Usuário não encontrado' });
            }

            if (user.promotion_active) {
                return res.status(400).json({ error: 'Divulgação já está ativa' });
            }

            const now = new Date();
            const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

            await user.update({
                fee_type: 'promotion',
                fee_rate: 10.00,
                promotion_active: true,
                promotion_started_at: now,
                promotion_ends_at: null,
                promotions_used_this_month: 0,
                promotions_reset_at: nextMonth
            });

            res.json({
                message: 'Divulgação ativada! Você agora tem direito a 3 divulgações por mês.',
                promotionActive: true,
                feeRate: 10,
                promotionsAvailable: 3
            });
        } catch (error) {
            console.error('[AuthController] Activate promotion error:', error);
            res.status(500).json({ error: 'Erro ao ativar divulgação' });
        }
    }

    /**
     * POST /api/auth/deactivate-promotion
     * Request to deactivate promotion (minimum 30 days)
     */
    async deactivatePromotion(req, res) {
        try {
            const user = await User.findByPk(req.userId);
            if (!user) {
                return res.status(404).json({ error: 'Usuário não encontrado' });
            }

            if (!user.promotion_active) {
                return res.status(400).json({ error: 'Divulgação não está ativa' });
            }

            const now = new Date();
            const startedAt = new Date(user.promotion_started_at);
            const minEndDate = new Date(startedAt.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days

            if (now < minEndDate) {
                // Can't deactivate yet, schedule for end of minimum period
                await user.update({
                    promotion_ends_at: minEndDate
                });

                const daysRemaining = Math.ceil((minEndDate - now) / (24 * 60 * 60 * 1000));

                return res.json({
                    message: `Desativação agendada! A divulgação será encerrada em ${daysRemaining} dias.`,
                    scheduledEndDate: minEndDate,
                    daysRemaining,
                    canDeactivateNow: false
                });
            }

            // Can deactivate immediately
            await user.update({
                fee_type: 'standard',
                fee_rate: 5.00,
                promotion_active: false,
                promotion_started_at: null,
                promotion_ends_at: null
            });

            res.json({
                message: 'Divulgação desativada! Sua taxa voltou para 5%.',
                promotionActive: false,
                feeRate: 5
            });
        } catch (error) {
            console.error('[AuthController] Deactivate promotion error:', error);
            res.status(500).json({ error: 'Erro ao desativar divulgação' });
        }
    }

    /**
     * POST /api/auth/submit-promotion
     * Submit a promotion request (uses 1 of 3 monthly slots)
     */
    async submitPromotion(req, res) {
        try {
            const { Setting } = require('../models');

            const user = await User.findByPk(req.userId);
            if (!user) {
                return res.status(404).json({ error: 'Usuário não encontrado' });
            }

            if (!user.promotion_active) {
                return res.status(400).json({
                    error: 'Ative a divulgação primeiro para enviar conteúdo',
                    code: 'PROMOTION_NOT_ACTIVE'
                });
            }

            // Check monthly limit
            const now = new Date();
            if (user.promotions_reset_at && now >= new Date(user.promotions_reset_at)) {
                // Reset counter
                const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
                await user.update({
                    promotions_used_this_month: 0,
                    promotions_reset_at: nextMonth
                });
            }

            if (user.promotions_used_this_month >= 3) {
                return res.status(400).json({
                    error: 'Você já usou suas 3 divulgações deste mês',
                    promotionsUsed: user.promotions_used_this_month,
                    resetsAt: user.promotions_reset_at,
                    code: 'LIMIT_REACHED'
                });
            }

            // Increment counter
            await user.update({
                promotions_used_this_month: user.promotions_used_this_month + 1
            });

            // Get support link from settings
            const settings = await Setting.findAll();
            const settingsObj = {};
            settings.forEach(s => { settingsObj[s.key] = s.value; });
            const supportLink = settingsObj.promotionContactLink || settingsObj.supportTelegramLink || 'https://t.me/suporte';

            res.json({
                message: 'Divulgação registrada! Envie seu conteúdo pelo link abaixo.',
                promotionsUsed: user.promotions_used_this_month,
                promotionsRemaining: 3 - user.promotions_used_this_month,
                contactLink: supportLink,
                resetsAt: user.promotions_reset_at
            });
        } catch (error) {
            console.error('[AuthController] Submit promotion error:', error);
            res.status(500).json({ error: 'Erro ao registrar divulgação' });
        }
    }

    /**
     * GET /api/auth/promotion-status
     * Get current promotion status
     */
    async getPromotionStatus(req, res) {
        try {
            const { Setting } = require('../models');

            const user = await User.findByPk(req.userId);
            if (!user) {
                return res.status(404).json({ error: 'Usuário não encontrado' });
            }

            // Check if need to reset monthly counter
            const now = new Date();
            if (user.promotions_reset_at && now >= new Date(user.promotions_reset_at)) {
                const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
                await user.update({
                    promotions_used_this_month: 0,
                    promotions_reset_at: nextMonth
                });
            }

            // Check if scheduled deactivation should happen
            if (user.promotion_ends_at && now >= new Date(user.promotion_ends_at)) {
                await user.update({
                    fee_type: 'standard',
                    fee_rate: 5.00,
                    promotion_active: false,
                    promotion_started_at: null,
                    promotion_ends_at: null
                });
            }

            // Get support link
            const settings = await Setting.findAll();
            const settingsObj = {};
            settings.forEach(s => { settingsObj[s.key] = s.value; });
            const supportLink = settingsObj.promotionContactLink || settingsObj.supportTelegramLink || null;

            // Calculate days until can deactivate
            let daysUntilCanDeactivate = 0;
            if (user.promotion_active && user.promotion_started_at) {
                const startedAt = new Date(user.promotion_started_at);
                const minEndDate = new Date(startedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
                if (now < minEndDate) {
                    daysUntilCanDeactivate = Math.ceil((minEndDate - now) / (24 * 60 * 60 * 1000));
                }
            }

            res.json({
                feeType: user.fee_type,
                feeRate: parseFloat(user.fee_rate),
                promotionActive: user.promotion_active,
                promotionStartedAt: user.promotion_started_at,
                promotionEndsAt: user.promotion_ends_at,
                promotionsUsedThisMonth: user.promotions_used_this_month,
                promotionsRemaining: user.promotion_active ? 3 - user.promotions_used_this_month : 0,
                promotionsResetsAt: user.promotions_reset_at,
                daysUntilCanDeactivate,
                canDeactivateNow: daysUntilCanDeactivate === 0,
                contactLink: supportLink,
                onboardingCompleted: user.onboarding_completed
            });
        } catch (error) {
            console.error('[AuthController] Get promotion status error:', error);
            res.status(500).json({ error: 'Erro ao buscar status' });
        }
    }

    /**
     * PUT /api/auth/profile
     * Update user profile (name, email)
     */
    async updateProfile(req, res) {
        try {
            const { name, email } = req.body;

            const user = await User.findByPk(req.userId);
            if (!user) {
                return res.status(404).json({ error: 'Usuário não encontrado' });
            }

            // Check if new email already exists
            if (email && email !== user.email) {
                const existing = await User.findOne({ where: { email } });
                if (existing) {
                    return res.status(400).json({ error: 'Este email já está em uso' });
                }
            }

            await user.update({
                name: name || user.name,
                email: email || user.email
            });

            res.json({
                message: 'Perfil atualizado com sucesso',
                user: user.toJSON()
            });
        } catch (error) {
            console.error('[AuthController] Update profile error:', error);
            res.status(500).json({ error: 'Erro ao atualizar perfil' });
        }
    }

    /**
     * PUT /api/auth/password
     * Change password
     */
    async changePassword(req, res) {
        try {
            const { currentPassword, newPassword } = req.body;

            if (!newPassword || newPassword.length < 6) {
                return res.status(400).json({ error: 'Nova senha deve ter pelo menos 6 caracteres' });
            }

            const user = await User.findByPk(req.userId);
            if (!user) {
                return res.status(404).json({ error: 'Usuário não encontrado' });
            }

            // Validate current password
            const isValid = await user.validatePassword(currentPassword);
            if (!isValid) {
                return res.status(401).json({ error: 'Senha atual incorreta' });
            }

            // Update password (hook will hash it)
            await user.update({ password_hash: newPassword });

            res.json({ message: 'Senha alterada com sucesso' });
        } catch (error) {
            console.error('[AuthController] Change password error:', error);
            res.status(500).json({ error: 'Erro ao alterar senha' });
        }
    }
}

module.exports = new AuthController();
