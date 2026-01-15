const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const bcrypt = require('bcryptjs');

const User = sequelize.define('User', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    name: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
        validate: {
            isEmail: true
        }
    },
    username: {
        type: DataTypes.STRING(100),
        allowNull: true,
        unique: true,
        comment: 'Username único para URL pública'
    },
    password_hash: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    role: {
        type: DataTypes.ENUM('admin', 'creator'),
        defaultValue: 'creator'
    },

    // ========== FEE & PROMOTION SYSTEM ==========
    fee_rate: {
        type: DataTypes.DECIMAL(5, 2),
        defaultValue: 5.00,
        comment: 'Taxa atual do criador (5% base ou 10% com divulgação)'
    },
    fee_type: {
        type: DataTypes.ENUM('standard', 'promotion'),
        defaultValue: 'standard',
        comment: 'standard = 5%, promotion = 10% com divulgação'
    },
    promotion_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        comment: 'Se está com divulgação ativa'
    },
    promotion_started_at: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Quando ativou a divulgação (mínimo 30 dias)'
    },
    promotion_ends_at: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Quando a desativação foi agendada'
    },
    promotions_used_this_month: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        comment: 'Divulgações usadas no mês (max 3)'
    },
    promotions_reset_at: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Próximo reset do contador de divulgações'
    },

    // ========== ONBOARDING ==========
    onboarding_completed: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        comment: 'Se completou o onboarding inicial'
    },
    terms_accepted_at: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Quando aceitou os termos'
    },

    // ========== PAYMENT GATEWAY ==========
    pix_key: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: 'Chave Pix para recebimento de repasses'
    },
    asaas_customer_id: {
        type: DataTypes.STRING(100),
        allowNull: true,
        comment: 'ID do cliente no Asaas'
    },
    asaas_wallet_id: {
        type: DataTypes.STRING(100),
        allowNull: true,
        comment: 'ID da wallet para Split (subconta Asaas)'
    },
    gateway_preference: {
        type: DataTypes.ENUM('asaas', 'mercadopago', 'stripe', 'pushinpay', 'syncpay', 'paradisepag'),
        defaultValue: 'pushinpay'
    },
    gateway_api_token: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Token de API do gateway escolhido pelo criador'
    },
    webhook_url: {
        type: DataTypes.STRING(500),
        allowNull: true,
        comment: 'URL exclusiva de webhook do criador'
    },
    status: {
        type: DataTypes.ENUM('active', 'paused', 'banned'),
        defaultValue: 'active'
    }
}, {
    tableName: 'users',
    hooks: {
        beforeCreate: async (user) => {
            if (user.password_hash) {
                user.password_hash = await bcrypt.hash(user.password_hash, 10);
            }
        },
        beforeUpdate: async (user) => {
            if (user.changed('password_hash')) {
                user.password_hash = await bcrypt.hash(user.password_hash, 10);
            }
        }
    }
});

// Instance methods
User.prototype.validatePassword = async function (password) {
    return bcrypt.compare(password, this.password_hash);
};

User.prototype.toJSON = function () {
    const values = { ...this.get() };
    delete values.password_hash;
    // Keep gateway_api_token visible for the user to edit their settings
    return values;
};

module.exports = User;
