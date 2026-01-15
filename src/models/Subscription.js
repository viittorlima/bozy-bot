const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Subscription = sequelize.define('Subscription', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    plan_id: {
        type: DataTypes.UUID,
        allowNull: true, // Allow null for custom offers
        references: {
            model: 'plans',
            key: 'id'
        }
    },
    user_telegram_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
        comment: 'ID do usuário no Telegram'
    },
    user_telegram_username: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    user_name: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    user_email: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    gateway: {
        type: DataTypes.ENUM('asaas', 'mercadopago', 'stripe', 'pushinpay', 'syncpay', 'paradisepag'),
        allowNull: false
    },
    gateway_subscription_id: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: 'ID da assinatura no Gateway'
    },
    gateway_customer_id: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: 'ID do cliente no Gateway'
    },
    status: {
        type: DataTypes.ENUM('pending', 'active', 'expired', 'cancelled', 'failed'),
        defaultValue: 'pending'
    },
    starts_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    expires_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    cancelled_at: {
        type: DataTypes.DATE,
        allowNull: true
    }
}, {
    tableName: 'subscriptions',
    indexes: [
        { fields: ['user_telegram_id'] },
        { fields: ['plan_id'] },
        { fields: ['status'] }
    ]
});

// Check if subscription is active
Subscription.prototype.isActive = function () {
    if (this.status !== 'active') return false;
    if (!this.expires_at) return true; // Vitalício
    return new Date() < new Date(this.expires_at);
};

module.exports = Subscription;
