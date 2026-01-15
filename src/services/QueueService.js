const cron = require('node-cron');
const { Op } = require('sequelize');
const { Broadcast, BroadcastItem, Subscription, Plan, Bot, User } = require('../models');
const TelegramEngine = require('./TelegramEngine');

/**
 * Queue Service
 * Handles background jobs like mailing
 */
class QueueService {
    constructor() {
        this.isProcessing = false;
        // Run every minute
        cron.schedule('* * * * *', () => this.processQueue());
        console.log('[QueueService] Mailing queue started');
    }

    async processQueue() {
        if (this.isProcessing) return;
        this.isProcessing = true;

        try {
            // 1. Process draft broadcasts (create items)
            await this.processDrafts();

            // 2. Process pending items (send messages)
            await this.processPendingItems();

        } catch (error) {
            console.error('[QueueService] Error processing queue:', error);
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Convert 'processing' broadcasts into queue items
     */
    async processDrafts() {
        // Find broadcasts that are ready to be queued
        const broadcasts = await Broadcast.findAll({
            where: { status: 'queued' }
        });

        for (const broadcast of broadcasts) {
            try {
                await broadcast.update({ status: 'processing' });

                // Build query based on filters
                const query = { status: 'active' }; // Default to active subs

                // Filter Status
                if (broadcast.filter_status && broadcast.filter_status !== 'all') {
                    if (broadcast.filter_status === 'new') {
                        // Created in last 7 days
                        const lastWeek = new Date();
                        lastWeek.setDate(lastWeek.getDate() - 7);
                        query.created_at = { [Op.gte]: lastWeek };
                    } else if (broadcast.filter_status === 'expired') {
                        query.status = 'expired';
                    } else if (broadcast.filter_status === 'pending') {
                        query.status = 'pending'; // usually payment pending, might not have telegram_id so be careful
                    }
                }

                // Filter Origin (Plan type/name)
                // This would require more complex filtering on Plan or Bot level if data structure supports it
                // For now, simplify to fetching all subscriptions that match general criteria
                // And filter in memory if necessary or refine query

                const subscriptions = await Subscription.findAll({
                    where: query,
                    attributes: ['user_telegram_id'],
                    group: ['user_telegram_id'] // Unique users
                });

                const items = subscriptions.map(sub => ({
                    broadcast_id: broadcast.id,
                    user_telegram_id: sub.user_telegram_id,
                    status: 'pending'
                }));

                // Bulk create items
                await BroadcastItem.bulkCreate(items);

                await broadcast.update({
                    total_recipients: items.length,
                    status: 'sending'
                });

                console.log(`[QueueService] Queueing ${items.length} msgs for Broadcast #${broadcast.id}`);

            } catch (error) {
                console.error(`[QueueService] Error queueing broadcast ${broadcast.id}:`, error);
                await broadcast.update({ status: 'failed', error_log: error.message });
            }
        }
    }

    /**
     * Process pending items
     */
    async processPendingItems() {
        // Fetch 50 pending items
        const items = await BroadcastItem.findAll({
            where: { status: 'pending' },
            limit: 50,
            include: ['broadcast']
        });

        if (items.length === 0) return;

        console.log(`[QueueService] Processing ${items.length} items...`);

        for (const item of items) {
            try {
                if (!item.broadcast) {
                    await item.update({ status: 'failed', error_message: 'No broadcast parent' });
                    continue;
                }

                const broadcast = item.broadcast;

                // Construct message options
                const options = {
                    parse_mode: 'Markdown',
                    protect_content: true // Item 3 requirement
                };

                // Add button if exists
                if (broadcast.button_text && broadcast.button_url) {
                    options.reply_markup = {
                        inline_keyboard: [[
                            { text: broadcast.button_text, url: broadcast.button_url }
                        ]]
                    };
                }

                // Send content based on type
                // Note: TelegramEngine needs methods exposed or use raw bot access
                // Since user wants to use TelegramEngine, we need to access the correct bot.
                // PROBLEM: Subscription relates to a specific Bot. But user_telegram_id might be same for multiple bots.
                // Broadcast essentially should be "From System" or "From Specific Bot"?
                // Usually Mailing is per Bot. But the filter didn't specify "Bot".
                // Assuming this is a "Super Admin" broadcast to ALL users across ALL bots?
                // OR assuming there's a default bot?
                // SAFEST: Send via one of the bots the user is subscribed to.

                // Let's find which bot the user is subscribed to active
                const sub = await Subscription.findOne({
                    where: {
                        user_telegram_id: item.user_telegram_id,
                        status: 'active'
                    },
                    include: [{ association: 'plan', include: ['bot'] }]
                });

                if (!sub || !sub.plan?.bot) {
                    await item.update({ status: 'failed', error_message: 'User has no active bot' });
                    continue;
                }

                const botId = sub.plan.bot.id;
                const telegrafBot = TelegramEngine.bots.get(botId);

                if (!telegrafBot) {
                    // Try to re-register?
                    await TelegramEngine.registerBot(sub.plan.bot);
                    // Retry next time or fail?
                    // Let's assume re-register might be needed async, so fail this time
                    await item.update({ status: 'failed', error_message: 'Bot instance not found' });
                    continue;
                }

                if (broadcast.type === 'text') {
                    await telegrafBot.telegram.sendMessage(item.user_telegram_id, broadcast.message_text, options);
                } else if (broadcast.type === 'photo') {
                    await telegrafBot.telegram.sendPhoto(item.user_telegram_id, broadcast.media_url, { ...options, caption: broadcast.message_text });
                } else if (broadcast.type === 'video') {
                    await telegrafBot.telegram.sendVideo(item.user_telegram_id, broadcast.media_url, { ...options, caption: broadcast.message_text });
                } else if (broadcast.type === 'audio') {
                    await telegrafBot.telegram.sendVoice(item.user_telegram_id, broadcast.media_url, { ...options, caption: broadcast.message_text });
                }

                await item.update({ status: 'sent' });
                await broadcast.increment('sent_count');

            } catch (error) {
                console.error(`[QueueService] Error sending item ${item.id}:`, error.message);
                await item.update({ status: 'failed', error_message: error.message });
                await item.broadcast.increment('failed_count');
            }
        }

        // Check if broadcasts are done
        // Optimization: Do this less frequently
    }
}

module.exports = new QueueService();
