import { AuthenticatedUser } from '../modules/auth/entities/AuthenticateUser';

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}