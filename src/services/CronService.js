const cron = require('node-cron');
const { Op } = require('sequelize');
const { Subscription, Plan } = require('../models');
const TelegramEngine = require('./TelegramEngine');

/**
 * Cron Service
 * Handles scheduled tasks like subscription expiration
 */
class CronService {
    constructor() {
        this.jobs = [];
    }

    /**
     * Initialize all cron jobs
     */
    init() {
        console.log('[CronService] Initializing scheduled tasks...');

        // Run every hour at minute 0 - check expired subscriptions
        const expirationJob = cron.schedule('0 * * * *', () => {
            this.processExpiredSubscriptions();
        }, {
            scheduled: true,
            timezone: 'America/Sao_Paulo'
        });

        this.jobs.push(expirationJob);

        // Daily promo message at 12:00 noon
        const dailyPromoJob = cron.schedule('0 12 * * *', async () => {
            await TelegramEngine.sendDailyPromoToAllBots();
        }, {
            scheduled: true,
            timezone: 'America/Sao_Paulo'
        });

        this.jobs.push(dailyPromoJob);

        // Monthly promotion counter reset at midnight on 1st day
        const monthlyResetJob = cron.schedule('0 0 1 * *', async () => {
            await this.resetMonthlyPromotions();
        }, {
            scheduled: true,
            timezone: 'America/Sao_Paulo'
        });

        this.jobs.push(monthlyResetJob);

        // Also run immediately on startup
        this.processExpiredSubscriptions();

        console.log('[CronService] ✅ Expiration check scheduled (every hour)');
        console.log('[CronService] ✅ Daily promo scheduled (12:00 noon)');
        console.log('[CronService] ✅ Monthly promotion reset scheduled (1st of month)');
    }

    /**
     * Process expired subscriptions
     * - Find active subscriptions with expires_at in the past
     * - Update status to 'expired'
     * - Ban user from Telegram channel
     * - Notify user via Telegram
     */
    async processExpiredSubscriptions() {
        console.log('[CronService] Checking for expired subscriptions...');

        try {
            const now = new Date();

            // Find expired subscriptions
            const expiredSubscriptions = await Subscription.findAll({
                where: {
                    status: 'active',
                    expires_at: {
                        [Op.not]: null,
                        [Op.lt]: now
                    }
                },
                include: [{
                    association: 'plan',
                    include: [{
                        association: 'bot'
                    }]
                }]
            });

            if (expiredSubscriptions.length === 0) {
                console.log('[CronService] No expired subscriptions found.');
                return;
            }

            console.log(`[CronService] Found ${expiredSubscriptions.length} expired subscriptions`);

            for (const subscription of expiredSubscriptions) {
                try {
                    // Update status to expired
                    await subscription.update({ status: 'expired' });

                    // Notify and remove from channel via TelegramEngine
                    await TelegramEngine.notifySubscriptionExpired(subscription);

                    console.log(`[CronService] Subscription ${subscription.id} expired for Telegram user ${subscription.user_telegram_id}`);
                } catch (error) {
                    console.error(`[CronService] Error processing subscription ${subscription.id}:`, error);
                }
            }

            console.log(`[CronService] Processed ${expiredSubscriptions.length} expired subscriptions`);
        } catch (error) {
            console.error('[CronService] Error in processExpiredSubscriptions:', error);
        }
    }

    /**
     * Check subscriptions expiring soon (for reminder notifications)
     * Run daily at 10:00 AM
     */
    initExpirationReminders() {
        const reminderJob = cron.schedule('0 10 * * *', async () => {
            await this.sendExpirationReminders();
        }, {
            scheduled: true,
            timezone: 'America/Sao_Paulo'
        });

        this.jobs.push(reminderJob);
        console.log('[CronService] ✅ Expiration reminders scheduled (daily at 10:00)');
    }

    /**
     * Send reminders 3 days before expiration
     */
    async sendExpirationReminders() {
        console.log('[CronService] Sending expiration reminders...');

        try {
            const threeDaysFromNow = new Date();
            threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);

            // Find subscriptions expiring in exactly 3 days
            const expiringSubscriptions = await Subscription.findAll({
                where: {
                    status: 'active',
                    expires_at: {
                        [Op.gte]: today,
                        [Op.lt]: threeDaysFromNow
                    }
                },
                include: [{
                    association: 'plan',
                    include: ['bot']
                }]
            });

            for (const subscription of expiringSubscriptions) {
                try {
                    await TelegramEngine.sendExpirationReminder(subscription);
                } catch (error) {
                    console.error(`[CronService] Error sending reminder for ${subscription.id}:`, error);
                }
            }

            console.log(`[CronService] Sent ${expiringSubscriptions.length} expiration reminders`);
        } catch (error) {
            console.error('[CronService] Error in sendExpirationReminders:', error);
        }
    }

    /**
     * Reset monthly promotion counters for all users
     * Run at midnight on 1st of each month
     */
    async resetMonthlyPromotions() {
        console.log('[CronService] Resetting monthly promotion counters...');

        try {
            const { User } = require('../models');

            const nextMonth = new Date();
            nextMonth.setMonth(nextMonth.getMonth() + 1);
            nextMonth.setDate(1);
            nextMonth.setHours(0, 0, 0, 0);

            // Reset all creators' promotion counters
            const [updated] = await User.update(
                {
                    promotions_used_this_month: 0,
                    promotions_reset_at: nextMonth
                },
                {
                    where: {
                        promotion_active: true
                    }
                }
            );

            console.log(`[CronService] Reset ${updated} creators' promotion counters`);
        } catch (error) {
            console.error('[CronService] Error resetting promotions:', error);
        }
    }

    /**
     * Stop all cron jobs
     */
    stop() {
        for (const job of this.jobs) {
            job.stop();
        }
        console.log('[CronService] All jobs stopped');
    }
}

module.exports = new CronService();
