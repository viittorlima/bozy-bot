const { Model, DataTypes } = require('sequelize');

class BroadcastItem extends Model {
    static init(sequelize) {
        super.init({
            status: { type: DataTypes.STRING, defaultValue: 'pending' }, // pending, sent, failed
            broadcast_id: DataTypes.INTEGER,
            user_telegram_id: DataTypes.STRING,
            error_message: DataTypes.TEXT
        }, {
            sequelize,
            tableName: 'broadcast_items',
            indexes: [
                { fields: ['status'] },
                { fields: ['broadcast_id'] }
            ]
        });
    }

    static associate(models) {
        this.belongsTo(models.Broadcast, { foreignKey: 'broadcast_id', as: 'broadcast' });
    }
}

module.exports = BroadcastItem;
