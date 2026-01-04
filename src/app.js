require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const config = require('./config');
const { testConnection } = require('./config/database');
const { syncDatabase } = require('./models');
const routes = require('./routes');
const TelegramEngine = require('./services/TelegramEngine');
const CronService = require('./services/CronService');
const WebhookController = require('./controllers/WebhookController');

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
    origin: config.urls.frontend,
    credentials: true
}));

// Stripe webhook needs raw body (before express.json())
app.post('/api/webhooks/stripe',
    express.raw({ type: 'application/json' }),
    WebhookController.handleStripe
);

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging
if (config.env === 'development') {
    app.use(morgan('dev'));
} else {
    app.use(morgan('combined'));
}

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        env: config.env
    });
});

// API Routes
app.use('/api', routes);

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Rota não encontrada' });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('[Error]', err);
    res.status(500).json({
        error: 'Erro interno do servidor',
        ...(config.env === 'development' && { details: err.message })
    });
});

// Start server
async function start() {
    try {
        // Test database connection
        await testConnection();

        // Sync models with FORCE (drops and recreates tables)
        // WARNING: This will delete all data! Only use in development or initial setup
        await syncDatabase(true);

        // Create default admin user
        await createDefaultAdmin();

        // Initialize Telegram bots
        await TelegramEngine.initialize();

        // Initialize Cron jobs (expiration check, etc.)
        CronService.init();

        // Start HTTP server
        app.listen(config.port, () => {
            console.log(`🚀 Server running on port ${config.port}`);
            console.log(`📡 API URL: ${config.urls.api}`);
            console.log(`🌐 Frontend URL: ${config.urls.frontend}`);
            console.log(`🔧 Environment: ${config.env}`);
            console.log(`💰 Platform Fee: ${config.platformFeePercent}%`);
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

// Create default admin user
async function createDefaultAdmin() {
    try {
        const { User } = require('./models');

        const adminExists = await User.findOne({ where: { email: 'admin@admin.com' } });
        if (!adminExists) {
            await User.create({
                name: 'Admin',
                email: 'admin@admin.com',
                username: 'admin',
                password_hash: 'admin123',
                role: 'admin',
                status: 'active'
            });
            console.log('✅ Admin created: admin@admin.com / admin123');
        } else {
            console.log('⏭️  Admin already exists');
        }
    } catch (error) {
        console.error('❌ Error creating admin:', error);
    }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('🛑 SIGTERM received. Shutting down...');
    CronService.stop();
    await TelegramEngine.shutdown();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('🛑 SIGINT received. Shutting down...');
    CronService.stop();
    await TelegramEngine.shutdown();
    process.exit(0);
});

start();

module.exports = app;
