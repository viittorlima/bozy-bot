const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Broadcast = sequelize.define('Broadcast', {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: 'draft' // draft, queued, processing, completed, failed
    },
    type: {
        type: DataTypes.STRING,
        defaultValue: 'text' // text, photo, video, audio
    },

    // Filters
    filter_status: DataTypes.STRING, // vips, new, expired, pending, all
    filter_behavior: DataTypes.STRING, // upsellers, downsellers, order_bump, all
    filter_origin: DataTypes.STRING, // packages, premium, all

    // Content
    message_text: DataTypes.TEXT,
    media_url: DataTypes.STRING,
    button_text: DataTypes.STRING,
    button_url: DataTypes.STRING,

    // Stats
    total_recipients: { type: DataTypes.INTEGER, defaultValue: 0 },
    sent_count: { type: DataTypes.INTEGER, defaultValue: 0 },
    failed_count: { type: DataTypes.INTEGER, defaultValue: 0 },
    total_sent: { type: DataTypes.INTEGER, defaultValue: 0 },
    total_failed: { type: DataTypes.INTEGER, defaultValue: 0 },

    scheduled_at: DataTypes.DATE,
    sent_at: DataTypes.DATE,
    completed_at: DataTypes.DATE,
    error_log: DataTypes.TEXT
}, {
    tableName: 'broadcasts'
});

module.exports = Broadcast;
