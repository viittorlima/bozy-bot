const { Model, DataTypes } = require('sequelize');

class Broadcast extends Model {
    static init(sequelize) {
        super.init({
            status: { type: DataTypes.STRING, defaultValue: 'draft' }, // draft, queued, processing, completed, failed
            type: { type: DataTypes.STRING, defaultValue: 'text' }, // text, photo, video, audio

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

            scheduled_at: DataTypes.DATE,
            completed_at: DataTypes.DATE,
            error_log: DataTypes.TEXT
        }, {
            sequelize,
            tableName: 'broadcasts'
        });
    }

    static associate(models) {
        // associations can be defined here if needed
    }
}

module.exports = Broadcast;
