const { Broadcast, BroadcastItem } = require('../models');

/**
 * Broadcast Controller
 * Manage mass messages
 */
class BroadcastController {
    /**
     * POST /api/broadcasts
     * Create a new broadcast draft
     */
    async create(req, res) {
        try {
            const {
                type, filter_status, filter_behavior, filter_origin,
                message_text, media_url, button_text, button_url,
                send_now
            } = req.body;

            const broadcast = await Broadcast.create({
                type,
                filter_status,
                filter_behavior,
                filter_origin,
                message_text,
                media_url,
                button_text,
                button_url,
                status: send_now ? 'queued' : 'draft',
                scheduled_at: send_now ? new Date() : null
            });

            res.status(201).json({ message: 'Broadcast criado', broadcast });
        } catch (error) {
            console.error('[BroadcastController] Create error:', error);
            res.status(500).json({ error: 'Erro ao criar broadcast' });
        }
    }

    /**
     * GET /api/broadcasts
     * List broadcasts
     */
    async list(req, res) {
        try {
            const broadcasts = await Broadcast.findAll({
                order: [['created_at', 'DESC']],
                limit: 50
            });
            res.json({ broadcasts });
        } catch (error) {
            console.error('[BroadcastController] List error:', error);
            res.status(500).json({ error: 'Erro ao listar broadcasts' });
        }
    }

    /**
     * POST /api/broadcasts/:id/send
     * Send a draft broadcast
     */
    async send(req, res) {
        try {
            const broadcast = await Broadcast.findByPk(req.params.id);
            if (!broadcast) {
                return res.status(404).json({ error: 'Broadcast não encontrado' });
            }

            if (broadcast.status !== 'draft') {
                return res.status(400).json({ error: 'Apenas rascunhos podem ser enviados' });
            }

            await broadcast.update({
                status: 'queued',
                scheduled_at: new Date()
            });

            res.json({ message: 'Broadcast agendado para envio', broadcast });
        } catch (error) {
            console.error('[BroadcastController] Send error:', error);
            res.status(500).json({ error: 'Erro ao enviar broadcast' });
        }
    }

    /**
     * DELETE /api/broadcasts/:id
     * Delete a broadcast
     */
    async delete(req, res) {
        try {
            const broadcast = await Broadcast.findByPk(req.params.id);
            if (!broadcast) {
                return res.status(404).json({ error: 'Broadcast não encontrado' });
            }

            await broadcast.destroy();
            res.json({ message: 'Broadcast excluído' });
        } catch (error) {
            console.error('[BroadcastController] Delete error:', error);
            res.status(500).json({ error: 'Erro ao excluir broadcast' });
        }
    }
}

module.exports = new BroadcastController();
