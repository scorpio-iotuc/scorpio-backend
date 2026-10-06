import { Router } from 'express';
import { UserController } from '../modules/users/controllers/UserController';
import { userRepository } from '../modules/users/repositories/UserRepository';
import { authMiddleware, requireAdmin } from '../middlewares/AuthMiddleware';

export const buildUserRoutes = (): Router => {
  const router = Router();
  const userController = UserController.build(userRepository);

  router.post('/', authMiddleware, requireAdmin, userController.create);
  router.get('/', authMiddleware, requireAdmin, userController.list);
  router.get('/:id', authMiddleware, userController.get);
  router.patch('/:id', authMiddleware, userController.update);
  router.delete('/:id', authMiddleware, userController.delete);

  return router;
};
