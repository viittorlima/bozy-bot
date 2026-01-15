const { Broadcast, BroadcastItem, Bot, Subscription } = require('../models');
const TelegramEngine = require('../services/TelegramEngine');
const { Op } = require('sequelize');

/**
 * Broadcast Controller
 * Manage mass messages for Admin and Creators
 */
class BroadcastController {
    /**
     * POST /api/admin/broadcasts
     * Create and send a broadcast (Admin - all users)
     */
    async createAdminBroadcast(req, res) {
        try {
            const {
                type, // 'text', 'photo', 'video'
                filter, // 'all', 'active', 'expired', 'pending'
                message,
                media_url,
                buttons // [{text, url}]
            } = req.body;

            if (!message && !media_url) {
                return res.status(400).json({ error: 'Mensagem ou mídia é obrigatória' });
            }

            // Get all bots
            const bots = await Bot.findAll({ where: { status: 'active' } });

            let totalSent = 0;
            let totalFailed = 0;

            for (const bot of bots) {
                // Get subscribers based on filter
                const subscribers = await TelegramEngine.getBotSubscribers(bot.id, filter || 'all');

                for (const telegramId of subscribers) {
                    let success = false;

                    if (type === 'photo' && media_url) {
                        success = await TelegramEngine.sendBroadcastPhoto(bot, telegramId, media_url, message, buttons);
                    } else if (type === 'video' && media_url) {
                        success = await TelegramEngine.sendBroadcastVideo(bot, telegramId, media_url, message, buttons);
                    } else {
                        success = await TelegramEngine.sendBroadcastMessage(bot, telegramId, message, buttons);
                    }

                    if (success) totalSent++;
                    else totalFailed++;

                    // Small delay to avoid rate limiting
                    await new Promise(r => setTimeout(r, 50));
                }
            }

            // Save broadcast record
            const broadcast = await Broadcast.create({
                type: type || 'text',
                filter_status: filter || 'all',
                message_text: message,
                media_url,
                button_text: buttons?.[0]?.text,
                button_url: buttons?.[0]?.url,
                status: 'completed',
                sent_at: new Date(),
                total_sent: totalSent,
                total_failed: totalFailed
            });

            res.json({
                message: 'Broadcast enviado',
                stats: { sent: totalSent, failed: totalFailed },
                broadcast
            });
        } catch (error) {
            console.error('[BroadcastController] Admin broadcast error:', error);
            res.status(500).json({ error: 'Erro ao enviar broadcast' });
        }
    }

    /**
     * POST /api/creator/broadcasts
     * Create and send a broadcast (Creator - their bots only)
     */
    async createCreatorBroadcast(req, res) {
        try {
            const creatorId = req.user.id;
            const {
                bot_id, // specific bot or 'all'
                type, // 'text', 'photo', 'video'
                filter, // 'all', 'active', 'expired'
                message,
                media_url,
                buttons // [{text, url}]
            } = req.body;

            if (!message && !media_url) {
                return res.status(400).json({ error: 'Mensagem ou mídia é obrigatória' });
            }

            // Get creator's bots
            let whereClause = { creator_id: creatorId, status: 'active' };
            if (bot_id && bot_id !== 'all') {
                whereClause.id = bot_id;
            }

            const bots = await Bot.findAll({ where: whereClause });

            if (bots.length === 0) {
                return res.status(404).json({ error: 'Nenhum bot encontrado' });
            }

            let totalSent = 0;
            let totalFailed = 0;

            for (const bot of bots) {
                // Get subscribers based on filter
                const subscribers = await TelegramEngine.getBotSubscribers(bot.id, filter || 'all');

                for (const telegramId of subscribers) {
                    let success = false;

                    if (type === 'photo' && media_url) {
                        success = await TelegramEngine.sendBroadcastPhoto(bot, telegramId, media_url, message, buttons);
                    } else if (type === 'video' && media_url) {
                        success = await TelegramEngine.sendBroadcastVideo(bot, telegramId, media_url, message, buttons);
                    } else {
                        success = await TelegramEngine.sendBroadcastMessage(bot, telegramId, message, buttons);
                    }

                    if (success) totalSent++;
                    else totalFailed++;

                    // Small delay to avoid rate limiting
                    await new Promise(r => setTimeout(r, 50));
                }
            }

            res.json({
                message: 'Broadcast enviado',
                stats: { sent: totalSent, failed: totalFailed }
            });
        } catch (error) {
            console.error('[BroadcastController] Creator broadcast error:', error);
            res.status(500).json({ error: 'Erro ao enviar broadcast' });
        }
    }

    /**
     * GET /api/admin/broadcasts
     * List broadcasts (Admin)
     */
    async list(req, res) {
        try {
            const broadcasts = await Broadcast.findAll({
                order: [['created_at', 'DESC']],
                limit: 50
            });
            res.json({ broadcasts });
        } catch (error) {
            console.error('[BroadcastController] List error:', error);
            res.status(500).json({ error: 'Erro ao listar broadcasts' });
        }
    }

    /**
     * DELETE /api/admin/broadcasts/:id
     * Delete a broadcast
     */
    async delete(req, res) {
        try {
            const broadcast = await Broadcast.findByPk(req.params.id);
            if (!broadcast) {
                return res.status(404).json({ error: 'Broadcast não encontrado' });
            }

            await broadcast.destroy();
            res.json({ message: 'Broadcast excluído' });
        } catch (error) {
            console.error('[BroadcastController] Delete error:', error);
            res.status(500).json({ error: 'Erro ao excluir broadcast' });
        }
    }
}

module.exports = new BroadcastController();
