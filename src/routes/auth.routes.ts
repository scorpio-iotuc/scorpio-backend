import { Router } from 'express';
import { userRepository } from '../modules/users/repositories/UserRepository';
import { AuthController } from '../modules/auth/controllers/AuthController';


export const buildAuthRoutes = (): Router => {
    const router = Router();
    const authController = AuthController.build(userRepository);

    router.get('/config', authController.config)
    router.post('/signup', authController.signup)
    router.post('/login', authController.login)

    return router;
}



export default buildAuthRoutes;
