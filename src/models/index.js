const { sequelize } = require('../config/database');
const User = require('./User');
const Bot = require('./Bot');
const Plan = require('./Plan');
const Subscription = require('./Subscription');
const Transaction = require('./Transaction');
const Setting = require('./Setting');

// Define Associations

// User -> Bots (1:N)
User.hasMany(Bot, { foreignKey: 'user_id', as: 'bots' });
Bot.belongsTo(User, { foreignKey: 'user_id', as: 'owner' });

// Bot -> Plans (1:N)
Bot.hasMany(Plan, { foreignKey: 'bot_id', as: 'plans' });
Plan.belongsTo(Bot, { foreignKey: 'bot_id', as: 'bot' });

// Plan -> Subscriptions (1:N)
Plan.hasMany(Subscription, { foreignKey: 'plan_id', as: 'subscriptions' });
Subscription.belongsTo(Plan, { foreignKey: 'plan_id', as: 'plan' });

// Subscription -> Transactions (1:N)
Subscription.hasMany(Transaction, { foreignKey: 'subscription_id', as: 'transactions' });
Transaction.belongsTo(Subscription, { foreignKey: 'subscription_id', as: 'subscription' });

// Sync all models
async function syncDatabase(force = false) {
    try {
        await sequelize.sync({ force });
        console.log('✅ Database synchronized successfully.');
    } catch (error) {
        console.error('❌ Error synchronizing database:', error);
        throw error;
    }
}

module.exports = {
    sequelize,
    User,
    Bot,
    Plan,
    Subscription,
    Transaction,
    Setting,
    syncDatabase
};

