import { Router } from 'express';
import authRoutes from './auth.js';
import categoryRoutes from './categories.js';
import entryRoutes from './entries.js';
import systemRoutes from './system.js';

const router = Router();
router.use('/auth', authRoutes);
router.use('/categories', categoryRoutes);
router.use('/entries', entryRoutes);
router.use('/system', systemRoutes);

export default router;
