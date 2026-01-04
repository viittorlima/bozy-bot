const { Op } = require('sequelize');
const { sequelize, User, Bot, Plan, Subscription, Transaction } = require('../models');

/**
 * Stats Controller
 * Dashboard statistics for creators and admin
 */
class StatsController {
    /**
     * GET /api/stats
     * Get stats for current creator
     */
    async getCreatorStats(req, res) {
        try {
            const userId = req.userId;

            // Get user's bots
            const bots = await Bot.findAll({
                where: { user_id: userId },
                attributes: ['id', 'username', 'name']
            });
            const botIds = bots.map(b => b.id);

            // Get plans for these bots
            const plans = await Plan.findAll({
                where: { bot_id: { [Op.in]: botIds } },
                attributes: ['id', 'name', 'bot_id']
            });
            const planIds = plans.map(p => p.id);

            // Active subscriptions
            const activeSubscriptions = await Subscription.count({
                where: {
                    plan_id: { [Op.in]: planIds },
                    status: 'active'
                }
            });

            // Pending sales
            const pendingSales = await Subscription.count({
                where: {
                    plan_id: { [Op.in]: planIds },
                    status: 'pending'
                }
            });

            // Today's revenue - use subquery approach
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            // Get subscription IDs for this creator's plans
            const creatorSubscriptions = await Subscription.findAll({
                where: { plan_id: { [Op.in]: planIds } },
                attributes: ['id']
            });
            const subscriptionIds = creatorSubscriptions.map(s => s.id);

            let todayRevenue = 0;
            let totalRevenue = 0;

            if (subscriptionIds.length > 0) {
                todayRevenue = await Transaction.sum('amount_net_creator', {
                    where: {
                        status: 'confirmed',
                        subscription_id: { [Op.in]: subscriptionIds },
                        paid_at: { [Op.gte]: today }
                    }
                }) || 0;

                totalRevenue = await Transaction.sum('amount_net_creator', {
                    where: {
                        status: 'confirmed',
                        subscription_id: { [Op.in]: subscriptionIds }
                    }
                }) || 0;
            }

            // Recent sales (all confirmed transactions)
            const recentSales = await Transaction.findAll({
                where: { status: 'confirmed' },
                include: [{
                    association: 'subscription',
                    where: { plan_id: { [Op.in]: planIds } },
                    include: [{
                        association: 'plan',
                        include: ['bot']
                    }]
                }],
                order: [['paid_at', 'DESC']],
                limit: 50
            });

            // All subscribers (active, expired, cancelled)
            const allSubscribers = await Subscription.findAll({
                where: { plan_id: { [Op.in]: planIds } },
                include: [{
                    association: 'plan',
                    include: ['bot']
                }],
                order: [['created_at', 'DESC']]
            });

            res.json({
                activeSubscribers: activeSubscriptions,
                pendingSales,
                todayRevenue: `R$ ${todayRevenue.toFixed(2).replace('.', ',')}`,
                totalRevenue: `R$ ${totalRevenue.toFixed(2).replace('.', ',')}`,
                totalBots: bots.length,
                totalPlans: plans.length,
                recentSales: recentSales.map(t => ({
                    id: t.id,
                    customer: t.subscription?.user_name || 'Anônimo',
                    telegramUsername: t.subscription?.user_telegram_username,
                    plan: t.subscription?.plan?.name || 'N/A',
                    botUsername: t.subscription?.plan?.bot?.username,
                    botId: t.subscription?.plan?.bot?.id,
                    amount: `R$ ${parseFloat(t.amount_net_creator).toFixed(2).replace('.', ',')}`,
                    status: 'paid',
                    paidAt: t.paid_at
                })),
                subscribers: allSubscribers.map(s => ({
                    id: s.id,
                    name: s.user_name || 'Usuário',
                    username: s.user_telegram_username,
                    telegramId: s.user_telegram_id,
                    planName: s.plan?.name || 'N/A',
                    botUsername: s.plan?.bot?.username,
                    botId: s.plan?.bot?.id,
                    status: s.status,
                    expiresAt: s.expires_at || (s.plan?.duration_days === 0 ? 'lifetime' : null),
                    createdAt: s.created_at
                }))
            });
        } catch (error) {
            console.error('[StatsController] Creator stats error:', error);
            res.status(500).json({ error: 'Erro ao buscar estatísticas' });
        }
    }

    /**
     * GET /api/admin/stats
     * Get platform-wide stats (admin only)
     */
    async getAdminStats(req, res) {
        try {
            // Total creators
            const totalCreators = await User.count({
                where: { role: 'creator' }
            });

            const activeCreators = await User.count({
                where: { role: 'creator', status: 'active' }
            });

            // Total subscribers
            const totalSubscribers = await Subscription.count({
                where: { status: 'active' }
            });

            // New subscribers this month
            const startOfMonth = new Date();
            startOfMonth.setDate(1);
            startOfMonth.setHours(0, 0, 0, 0);

            const newSubscribersMonth = await Subscription.count({
                where: {
                    created_at: { [Op.gte]: startOfMonth }
                }
            });

            // Total revenue (all platform)
            const totalRevenue = await Transaction.sum('amount_gross', {
                where: { status: 'confirmed' }
            }) || 0;

            // Total commission
            const totalCommission = await Transaction.sum('amount_platform_fee', {
                where: { status: 'confirmed' }
            }) || 0;

            // Total pending payouts (creator net amounts)
            const pendingPayouts = await Transaction.sum('amount_net_creator', {
                where: { status: 'confirmed' }
            }) || 0;

            // Recent transactions
            const recentTransactions = await Transaction.findAll({
                where: { status: 'confirmed' },
                include: [{
                    association: 'subscription',
                    include: [{
                        association: 'plan',
                        include: [{
                            association: 'bot',
                            include: ['owner']
                        }]
                    }]
                }],
                order: [['paid_at', 'DESC']],
                limit: 20
            });

            res.json({
                totalCreators,
                activeCreators,
                totalSubscribers,
                newSubscribersMonth,
                totalRevenue,
                totalCommission,
                pendingPayouts,
                recentTransactions: recentTransactions.map(t => ({
                    id: t.id,
                    creator: t.subscription?.plan?.bot?.owner?.name || 'N/A',
                    customer: t.subscription?.user_name || 'Anônimo',
                    amount: parseFloat(t.amount_gross),
                    commission: parseFloat(t.amount_platform_fee),
                    paidAt: t.paid_at
                }))
            });
        } catch (error) {
            console.error('[StatsController] Admin stats error:', error);
            res.status(500).json({ error: 'Erro ao buscar estatísticas' });
        }
    }
}

module.exports = new StatsController();
