const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const BroadcastItem = sequelize.define('BroadcastItem', {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: 'pending' // pending, sent, failed
    },
    broadcast_id: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    user_telegram_id: DataTypes.STRING,
    error_message: DataTypes.TEXT
}, {
    tableName: 'broadcast_items',
    indexes: [
        { fields: ['status'] },
        { fields: ['broadcast_id'] }
    ]
});

module.exports = BroadcastItem;
