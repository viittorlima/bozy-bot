const express = require('express');
const router = express.Router();

const { authMiddleware, adminMiddleware } = require('../middleware/auth');

// Controllers
const AuthController = require('../controllers/AuthController');
const BotController = require('../controllers/BotController');
const PlanController = require('../controllers/PlanController');
const CheckoutController = require('../controllers/CheckoutController');
const WebhookController = require('../controllers/WebhookController');
const StatsController = require('../controllers/StatsController');
const BroadcastController = require('../controllers/BroadcastController');

// ============================================
// PUBLIC ROUTES
// ============================================

// Auth
router.post('/auth/register', AuthController.register);
router.post('/auth/login', AuthController.login);

// Checkout (public - for end users)
router.post('/checkout/link', CheckoutController.generateLink);
router.post('/checkout/create', CheckoutController.generateLink); // Alias for frontend compatibility
router.get('/checkout/status/:subscriptionId', CheckoutController.checkStatus);

// Plans (public - for viewing on creator profile)
router.get('/plans/:id', PlanController.get);

// Public settings (for landing page)
router.get('/public/settings', async (req, res) => {
    try {
        const { Setting } = require('../models');
        const config = require('../config');

        const settings = await Setting.findAll();
        const settingsObj = {};
        settings.forEach(s => {
            settingsObj[s.key] = s.value;
        });

        res.json({
            platformFee: parseFloat(settingsObj.platformFee) || config.platformFeePercent || 10,
            siteName: settingsObj.siteName || 'Boyz Vip'
        });
    } catch (error) {
        console.error('Error fetching public settings:', error);
        res.json({ platformFee: 10, siteName: 'Boyz Vip' });
    }
});

// Public legal content (for terms page)
router.get('/public/legal', async (req, res) => {
    try {
        const { Setting } = require('../models');

        const termsOfUse = await Setting.findOne({ where: { key: 'termsOfUse' } });
        const privacyPolicy = await Setting.findOne({ where: { key: 'privacyPolicy' } });
        const disclaimer = await Setting.findOne({ where: { key: 'disclaimer' } });

        res.json({
            termsOfUse: termsOfUse?.value || '',
            privacyPolicy: privacyPolicy?.value || '',
            disclaimer: disclaimer?.value || ''
        });
    } catch (error) {
        console.error('Error fetching legal content:', error);
        res.json({ termsOfUse: '', privacyPolicy: '', disclaimer: '' });
    }
});

// Public: Get creator profile with bots list
router.get('/plans/public/:username', async (req, res) => {
    try {
        const { User, Bot, Plan } = require('../models');

        // Find user by username
        const user = await User.findOne({
            where: {
                username: req.params.username
            },
            include: [{
                association: 'bots',
                where: { status: 'active' },
                required: false,
                include: [{
                    association: 'plans',
                    where: { status: 'active' },
                    required: false
                }]
            }]
        });

        if (!user) {
            return res.status(404).json({ error: 'Criador não encontrado' });
        }

        // Return bots with their plans count
        const bots = (user.bots || []).map(bot => ({
            id: bot.id,
            username: bot.username,
            name: bot.name,
            plans: bot.plans || []
        }));

        res.json({
            creator: {
                name: user.name,
                username: user.username,
                bio: 'Criador de conteúdo exclusivo'
            },
            bots
        });
    } catch (error) {
        console.error('Error fetching public plans:', error);
        res.status(500).json({ error: 'Erro ao buscar planos' });
    }
});

// Public: Get bot public page with plans
router.get('/bots/public/:botUsername', async (req, res) => {
    try {
        const { Bot, Plan } = require('../models');

        const bot = await Bot.findOne({
            where: {
                username: req.params.botUsername,
                status: 'active'
            },
            include: [{
                association: 'plans',
                where: { status: 'active' },
                required: false
            }]
        });

        if (!bot) {
            return res.status(404).json({ error: 'Bot não encontrado' });
        }

        res.json({
            bot: {
                id: bot.id,
                username: bot.username,
                name: bot.name,
                welcome_message: bot.welcome_message
            },
            plans: bot.plans || []
        });
    } catch (error) {
        console.error('Error fetching bot:', error);
        res.status(500).json({ error: 'Erro ao buscar bot' });
    }
});

// ============================================
// WEBHOOK ROUTES (No auth - called by gateways)
// ============================================

router.post('/webhooks/asaas', WebhookController.handleAsaas);
router.post('/webhooks/mercadopago', WebhookController.handleMercadoPago);
router.post('/webhooks/pushinpay', WebhookController.handlePushinPay);
router.post('/webhooks/syncpay', WebhookController.handleSyncPay);
router.post('/webhooks/paradisepag', WebhookController.handleParadisePag);
router.post('/webhooks/telegram/:token', WebhookController.handleTelegram);

// Stripe needs raw body, handled separately in app.js

// ============================================
// PROTECTED ROUTES (Require auth)
// ============================================

// Auth protected
router.get('/auth/me', authMiddleware, AuthController.me);
router.put('/auth/gateway', authMiddleware, AuthController.updateGateway);

// Onboarding & Promotion
router.post('/auth/complete-onboarding', authMiddleware, AuthController.completeOnboarding);
router.get('/auth/promotion-status', authMiddleware, AuthController.getPromotionStatus);
router.post('/auth/activate-promotion', authMiddleware, AuthController.activatePromotion);
router.post('/auth/deactivate-promotion', authMiddleware, AuthController.deactivatePromotion);
router.post('/auth/submit-promotion', authMiddleware, AuthController.submitPromotion);

// Profile & Password
router.put('/auth/profile', authMiddleware, AuthController.updateProfile);
router.put('/auth/password', authMiddleware, AuthController.changePassword);

// Stats
router.get('/stats', authMiddleware, StatsController.getCreatorStats);
router.get('/stats/ranking', authMiddleware, StatsController.getRanking);

// Bots
router.get('/bots', authMiddleware, BotController.list);
router.get('/bots/:id', authMiddleware, BotController.get);
router.post('/bots/connect', authMiddleware, BotController.connect);
router.put('/bots/:id', authMiddleware, BotController.update);
router.delete('/bots/:id', authMiddleware, BotController.delete);

// Plans
router.get('/plans', authMiddleware, PlanController.list);
router.post('/plans', authMiddleware, PlanController.create);
router.put('/plans/:id', authMiddleware, PlanController.update);
router.delete('/plans/:id', authMiddleware, PlanController.delete);

// ============================================
// ADMIN ROUTES
// ============================================

router.get('/admin/stats', authMiddleware, adminMiddleware, StatsController.getAdminStats);

// Admin: List all creators
router.get('/admin/creators', authMiddleware, adminMiddleware, async (req, res) => {
    const { User } = require('../models');
    const creators = await User.findAll({
        where: { role: 'creator' },
        order: [['created_at', 'DESC']]
    });
    res.json({ creators });
});

// Admin: Impersonate (login as creator)
router.post('/admin/impersonate/:userId', authMiddleware, adminMiddleware, async (req, res) => {
    const { User } = require('../models');
    const jwt = require('jsonwebtoken');
    const config = require('../config');

    const user = await User.findByPk(req.params.userId);
    if (!user) {
        return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const token = jwt.sign(
        { userId: user.id, role: user.role, impersonatedBy: req.userId },
        config.jwt.secret,
        { expiresIn: '1h' }
    );

    res.json({ token, user: user.toJSON() });
});

// Admin: Ban creator
router.post('/admin/creators/:userId/ban', authMiddleware, adminMiddleware, async (req, res) => {
    const { User } = require('../models');

    const user = await User.findByPk(req.params.userId);
    if (!user) {
        return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    await user.update({ status: 'banned' });
    res.json({ message: 'Usuário banido', user: user.toJSON() });
});

// Admin: Toggle creator status (ban/unban)
router.post('/admin/creators/:userId/toggle-status', authMiddleware, adminMiddleware, async (req, res) => {
    const { User } = require('../models');

    const user = await User.findByPk(req.params.userId);
    if (!user) {
        return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const newStatus = user.status === 'banned' ? 'active' : 'banned';
    await user.update({ status: newStatus });
    res.json({ message: `Usuário ${newStatus}`, user: user.toJSON() });
});

// Admin: Update creator fee rate
router.put('/admin/creators/:userId/fee', authMiddleware, adminMiddleware, async (req, res) => {
    const { User } = require('../models');
    const { feeRate, feeType, promotionsUsed } = req.body;

    const user = await User.findByPk(req.params.userId);
    if (!user) {
        return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    const updateData = {
        fee_rate: parseFloat(feeRate) || 5,
        fee_type: feeType || 'standard',
        promotion_active: feeType === 'promotion'
    };

    // Update promotions used if provided
    if (typeof promotionsUsed === 'number' || promotionsUsed !== undefined) {
        updateData.promotions_used_this_month = parseInt(promotionsUsed) || 0;
    }

    await user.update(updateData);

    res.json({
        message: 'Taxa atualizada',
        feeRate: user.fee_rate,
        feeType: user.fee_type,
        promotionActive: user.promotion_active,
        promotionsUsed: user.promotions_used_this_month
    });
});

// Admin: Create new creator
router.post('/admin/creators', authMiddleware, adminMiddleware, async (req, res) => {
    const { User } = require('../models');
    const bcrypt = require('bcryptjs');

    const { name, email, password } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
    }

    // Check if email exists
    const existing = await User.findOne({ where: { email } });
    if (existing) {
        return res.status(400).json({ error: 'Email já cadastrado' });
    }

    // Create user
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
        name,
        email,
        password: hashedPassword,
        role: 'creator',
        status: 'active'
    });

    res.status(201).json({ message: 'Criador criado', user: user.toJSON() });
});

// Admin: Get platform settings
router.get('/admin/settings', authMiddleware, adminMiddleware, async (req, res) => {
    const { Setting } = require('../models');

    try {
        const settings = await Setting.findAll();
        const settingsObj = {};
        settings.forEach(s => {
            settingsObj[s.key] = s.value;
        });

        res.json({
            fixed_fee_amount: parseFloat(settingsObj.fixed_fee_amount || '0.55'),
            gateway: settingsObj.gateway || 'asaas',
            walletId: settingsObj.walletId || '',
            // PushinPay
            pushinpay_api_token: settingsObj.pushinpay_api_token || '',
            // Asaas
            asaas_api_key: settingsObj.asaas_api_key || '',
            asaas_webhook_token: settingsObj.asaas_webhook_token || '',
            // Mercado Pago
            mp_access_token: settingsObj.mp_access_token || '',
            mp_public_key: settingsObj.mp_public_key || '',
            // SyncPay
            syncpay_api_key: settingsObj.syncpay_api_key || '',
            syncpay_platform_recipient_id: settingsObj.syncpay_platform_recipient_id || '',
            syncpay_default_recipient_id: settingsObj.syncpay_default_recipient_id || '',
            // ParadisePag
            paradisepag_public_key: settingsObj.paradisepag_public_key || '',
            paradisepag_secret_key: settingsObj.paradisepag_secret_key || ''
        });
    } catch (error) {
        // Settings table might not exist yet
        res.json({
            fixed_fee_amount: 0.55,
            gateway: 'asaas',
            walletId: ''
        });
    }
});

// Admin: Update platform settings
router.put('/admin/settings', authMiddleware, adminMiddleware, async (req, res) => {
    const { Setting } = require('../models');

    const {
        siteName, siteUrl, supportEmail, platformChannelUsername,
        promotionContactLink, supportTelegramLink, enableRegistration,
        requireEmailVerification, maintenanceMode, fixed_fee_amount, gateway, walletId,
        pushinpay_api_token, asaas_api_key, asaas_webhook_token,
        mp_access_token, mp_public_key,
        syncpay_api_key, syncpay_platform_recipient_id, syncpay_default_recipient_id,
        paradisepag_public_key, paradisepag_secret_key
    } = req.body;

    try {
        // Upsert all settings
        if (siteName !== undefined) await Setting.upsert({ key: 'siteName', value: siteName });
        if (siteUrl !== undefined) await Setting.upsert({ key: 'siteUrl', value: siteUrl });
        if (supportEmail !== undefined) await Setting.upsert({ key: 'supportEmail', value: supportEmail });
        if (platformChannelUsername !== undefined) await Setting.upsert({ key: 'platformChannelUsername', value: platformChannelUsername });
        if (promotionContactLink !== undefined) await Setting.upsert({ key: 'promotionContactLink', value: promotionContactLink });
        if (supportTelegramLink !== undefined) await Setting.upsert({ key: 'supportTelegramLink', value: supportTelegramLink });
        if (enableRegistration !== undefined) await Setting.upsert({ key: 'enableRegistration', value: String(enableRegistration) });
        if (requireEmailVerification !== undefined) await Setting.upsert({ key: 'requireEmailVerification', value: String(requireEmailVerification) });
        if (maintenanceMode !== undefined) await Setting.upsert({ key: 'maintenanceMode', value: String(maintenanceMode) });
        if (fixed_fee_amount !== undefined) await Setting.upsert({ key: 'fixed_fee_amount', value: String(fixed_fee_amount) });
        if (gateway !== undefined) await Setting.upsert({ key: 'gateway', value: gateway });
        if (walletId !== undefined) await Setting.upsert({ key: 'walletId', value: walletId });

        // PushinPay
        if (pushinpay_api_token !== undefined) await Setting.upsert({ key: 'pushinpay_api_token', value: pushinpay_api_token });

        // Asaas
        if (asaas_api_key !== undefined) await Setting.upsert({ key: 'asaas_api_key', value: asaas_api_key });
        if (asaas_webhook_token !== undefined) await Setting.upsert({ key: 'asaas_webhook_token', value: asaas_webhook_token });

        // Mercado Pago
        if (mp_access_token !== undefined) await Setting.upsert({ key: 'mp_access_token', value: mp_access_token });
        if (mp_public_key !== undefined) await Setting.upsert({ key: 'mp_public_key', value: mp_public_key });

        // SyncPay
        if (syncpay_api_key !== undefined) await Setting.upsert({ key: 'syncpay_api_key', value: syncpay_api_key });
        if (syncpay_platform_recipient_id !== undefined) await Setting.upsert({ key: 'syncpay_platform_recipient_id', value: syncpay_platform_recipient_id });
        if (syncpay_default_recipient_id !== undefined) await Setting.upsert({ key: 'syncpay_default_recipient_id', value: syncpay_default_recipient_id });

        // ParadisePag
        if (paradisepag_public_key !== undefined) await Setting.upsert({ key: 'paradisepag_public_key', value: paradisepag_public_key });
        if (paradisepag_secret_key !== undefined) await Setting.upsert({ key: 'paradisepag_secret_key', value: paradisepag_secret_key });

        res.json({ message: 'Configurações salvas' });
    } catch (error) {
        console.error('Error saving settings:', error);
        res.status(500).json({ error: 'Erro ao salvar configurações' });
    }
});

// Admin: Get legal content
router.get('/admin/legal', authMiddleware, adminMiddleware, async (req, res) => {
    const { Setting } = require('../models');

    try {
        const termsOfUse = await Setting.findOne({ where: { key: 'termsOfUse' } });
        const privacyPolicy = await Setting.findOne({ where: { key: 'privacyPolicy' } });
        const disclaimer = await Setting.findOne({ where: { key: 'disclaimer' } });

        res.json({
            termsOfUse: termsOfUse?.value || '',
            privacyPolicy: privacyPolicy?.value || '',
            disclaimer: disclaimer?.value || ''
        });
    } catch (error) {
        console.error('Error loading legal:', error);
        res.status(500).json({ error: 'Erro ao carregar' });
    }
});

// Admin: Update legal content
router.put('/admin/legal', authMiddleware, adminMiddleware, async (req, res) => {
    const { Setting } = require('../models');
    const { termsOfUse, privacyPolicy, disclaimer } = req.body;

    try {
        if (termsOfUse !== undefined) await Setting.upsert({ key: 'termsOfUse', value: termsOfUse });
        if (privacyPolicy !== undefined) await Setting.upsert({ key: 'privacyPolicy', value: privacyPolicy });
        if (disclaimer !== undefined) await Setting.upsert({ key: 'disclaimer', value: disclaimer });

        res.json({ message: 'Textos legais salvos' });
    } catch (error) {
        console.error('Error saving legal:', error);
        res.status(500).json({ error: 'Erro ao salvar' });
    }
});

// Admin: Broadcasts (Mailing)
router.post('/admin/broadcasts', authMiddleware, adminMiddleware, BroadcastController.createAdminBroadcast);
router.get('/admin/broadcasts', authMiddleware, adminMiddleware, BroadcastController.list);
router.delete('/admin/broadcasts/:id', authMiddleware, adminMiddleware, BroadcastController.delete);

// Creator: Broadcasts (Mailing para criadores)
router.post('/creator/broadcasts', authMiddleware, BroadcastController.createCreatorBroadcast);

module.exports = router;

