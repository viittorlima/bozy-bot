const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Bot = sequelize.define('Bot', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'users',
            key: 'id'
        }
    },
    token: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: 'Token do Bot do Telegram (BotFather)'
    },
    username: {
        type: DataTypes.STRING(100),
        allowNull: true,
        comment: 'Username do bot no Telegram (@botname)'
    },
    name: {
        type: DataTypes.STRING(255),
        allowNull: true,
        comment: 'Nome amigável do bot'
    },
    welcome_message: {
        type: DataTypes.TEXT,
        defaultValue: 'Olá {nome}! Bem-vindo ao grupo VIP!',
        comment: 'Mensagem de boas-vindas. Use {nome} para o nome do usuário.'
    },
    request_media_on_start: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        comment: 'Solicitar mídia no início'
    },
    channel_id: {
        type: DataTypes.STRING(100),
        allowNull: true,
        comment: 'ID do canal/grupo VIP no Telegram'
    },
    status: {
        type: DataTypes.ENUM('active', 'paused', 'error'),
        defaultValue: 'active'
    },
    last_error: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    webhook_set: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    anti_cloning: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        comment: 'Proteção de conteúdo (proibir encaminhamento/salvamento)'
    }
}, {
    tableName: 'bots'
});

// Hide token in JSON output
Bot.prototype.toJSON = function () {
    const values = { ...this.get() };
    values.token = values.token ? values.token.substring(0, 15) + '...hidden' : null;
    return values;
};

module.exports = Bot;
