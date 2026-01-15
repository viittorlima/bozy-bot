const { Bot, Plan, User } = require('../models');
const TelegramEngine = require('../services/TelegramEngine');

/**
 * Bot Controller
 * Manage Telegram bots for creators
 */
class BotController {
    /**
     * GET /api/bots
     * List all bots for current user
     */
    async list(req, res) {
        try {
            const bots = await Bot.findAll({
                where: { user_id: req.userId },
                include: [{
                    association: 'plans',
                    where: { status: 'active' },
                    required: false
                }],
                order: [['created_at', 'DESC']]
            });

            const user = await User.findByPk(req.userId, { attributes: ['gateway_api_token', 'gateway_preference'] });

            res.json({
                bots,
                hasGateway: !!user?.gateway_api_token,
                gatewayName: user?.gateway_preference ? user.gateway_preference.charAt(0).toUpperCase() + user.gateway_preference.slice(1) : null
            });
        } catch (error) {
            console.error('[BotController] List error:', error);
            res.status(500).json({ error: 'Erro ao listar bots' });
        }
    }

    /**
     * GET /api/bots/:id
     * Get single bot
     */
    async get(req, res) {
        try {
            const bot = await Bot.findOne({
                where: { id: req.params.id, user_id: req.userId },
                include: ['plans']
            });

            if (!bot) {
                return res.status(404).json({ error: 'Bot não encontrado' });
            }

            res.json({ bot });
        } catch (error) {
            console.error('[BotController] Get error:', error);
            res.status(500).json({ error: 'Erro ao buscar bot' });
        }
    }

    /**
     * POST /api/bots/connect
     * Connect new bot with token
     */
    async connect(req, res) {
        try {
            const { token, name } = req.body;

            if (!token) {
                return res.status(400).json({ error: 'Token é obrigatório' });
            }

            // Validate token
            const botInfo = await TelegramEngine.validateToken(token);
            if (!botInfo) {
                return res.status(400).json({ error: 'Token inválido. Verifique se copiou corretamente do BotFather.' });
            }

            // Check if token already registered
            const existingBot = await Bot.findOne({ where: { token } });
            if (existingBot) {
                return res.status(400).json({ error: 'Este bot já está conectado' });
            }

            // Create bot record
            const bot = await Bot.create({
                user_id: req.userId,
                token,
                username: botInfo.username,
                name: name || botInfo.first_name,
                status: 'active'
            });

            // Register with TelegramEngine
            await TelegramEngine.registerBot(bot);

            res.status(201).json({
                message: 'Bot conectado com sucesso',
                bot: bot.toJSON()
            });
        } catch (error) {
            console.error('[BotController] Connect error:', error);
            res.status(500).json({ error: 'Erro ao conectar bot' });
        }
    }

    /**
     * PUT /api/bots/:id
     * Update bot settings
     */
    async update(req, res) {
        try {
            const {
                name,
                welcomeMessage, welcome_message,
                requestMediaOnStart, request_media_on_start,
                channelId, channel_id,
                status,
                antiCloning, anti_cloning
            } = req.body;

            const bot = await Bot.findOne({
                where: { id: req.params.id, user_id: req.userId }
            });

            if (!bot) {
                return res.status(404).json({ error: 'Bot não encontrado' });
            }

            await bot.update({
                name: name ?? bot.name,
                welcome_message: welcomeMessage ?? welcome_message ?? bot.welcome_message,
                request_media_on_start: requestMediaOnStart ?? request_media_on_start ?? bot.request_media_on_start,
                channel_id: channelId ?? channel_id ?? bot.channel_id,
                status: status ?? bot.status,
                anti_cloning: antiCloning ?? anti_cloning ?? bot.anti_cloning
            });

            // Re-register if status changed
            if (status === 'active') {
                await TelegramEngine.registerBot(bot);
            } else if (status === 'paused') {
                await TelegramEngine.stopBot(bot.id);
            }

            res.json({
                message: 'Bot atualizado',
                bot: bot.toJSON()
            });
        } catch (error) {
            console.error('[BotController] Update error:', error);
            res.status(500).json({ error: 'Erro ao atualizar bot' });
        }
    }

    /**
     * DELETE /api/bots/:id
     * Delete bot
     */
    async delete(req, res) {
        try {
            const bot = await Bot.findOne({
                where: { id: req.params.id, user_id: req.userId }
            });

            if (!bot) {
                return res.status(404).json({ error: 'Bot não encontrado' });
            }

            // Stop bot
            await TelegramEngine.stopBot(bot.id);

            // Delete plans first
            await Plan.destroy({ where: { bot_id: bot.id } });

            // Delete bot
            await bot.destroy();

            res.json({ message: 'Bot removido com sucesso' });
        } catch (error) {
            console.error('[BotController] Delete error:', error);
            res.status(500).json({ error: 'Erro ao remover bot' });
        }
    }
}

module.exports = new BotController();
