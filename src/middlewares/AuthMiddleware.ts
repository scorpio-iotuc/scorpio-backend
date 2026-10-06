import { Request, Response, NextFunction } from 'express';
import { JwtService } from '../modules/auth/services/JwtService';
import { UserType } from '../modules/users/entities/User';

export const authMiddleware = (req: Request, res: Response, next: NextFunction): Response | void => {
    const jwtService = new JwtService()
    const authorization = req.header('authorization');
    if (!authorization) {
        return res.status(401).json({ message: 'Missing authorization header' });
    }
    const [scheme, token] = authorization.split(' ');
    if (scheme !== 'Bearer' || !token) {
        return res.status(401).json({ message: 'Invalid authorization header' });
    }
    try {
        const payload = jwtService.verify(token)
        req.user = { id: Number(payload.sub), email: payload.email, type: payload.type, };
        next();
    } catch {
        return res.status(401).json({ message: 'Invalid token', });
    }
};

export const requireAdmin = (req: Request, res: Response, next: NextFunction): Response | void => {
    if (req.user?.type !== UserType.ADMIN) {
        return res.status(403).json({ message: 'Admin privileges required' });
    }
    next();
};
