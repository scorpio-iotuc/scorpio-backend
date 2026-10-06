import { Request, Response } from 'express';
import { UserRepository } from '../../users/repositories/UserRepository';
import { SignUp } from '../use-cases/SignUp';
import { Login } from '../use-cases/LogIn';
import { getSignupMode, isPublicSignupEnabled } from '../../../lib/config';

export class AuthController {
  private readonly signUp: SignUp;
  private readonly logIn: Login;
  constructor(userRepository: UserRepository) {
    this.signUp = new SignUp(userRepository);
    this.logIn = new Login(userRepository);
  }

  public static build(userRepository: UserRepository): AuthController {
    return new AuthController(userRepository);
  };

  config = async (_req: Request, res: Response): Promise<Response> => {
    return res.status(200).json({ signupMode: getSignupMode() });
  };

  signup = async (req: Request, res: Response): Promise<Response> => {
    try {
      console.log('[Users][SIGNUP] Request received');
      if (!isPublicSignupEnabled()) {
        return res.status(403).json({ message: 'Public signup is disabled' });
      }
      const body = req.body;
      if (
        typeof body?.name !== 'string' ||
        typeof body?.email !== 'string' ||
        typeof body?.password !== 'string'
      ) {
        return res.status(400).json({
          message: 'Invalid request body',
        });
      }
      const result = await this.signUp.execute({
        name: body.name,
        email: body.email,
        password: body.password,
      });
      if (!result) {
        console.error('[Users][SIGNUP] Failed to sign up', result);
        return res.status(409).json({"message": "User already exists."})
      }
      console.log('[Users][SIGNUP] User signed up successfully');
      return res.status(200).json(result)
    } catch (error) {
      console.error('[Users][SIGNUP] Failed to create user', error);
      return res.status(500).json({ message: 'Unexpected error. check the logs for more details' });
    }
  };

  login = async (req: Request, res: Response): Promise<Response> => {
    const body = req.body;
    console.info('[Users][LOGIN] Request received');
    try {
      if ((!body || typeof body !== 'object')
        || (typeof body.email !== 'string')
        || (typeof body.password !== 'string')) {
        return res.status(400).json({
          message: 'Invalid request body',
        });
      }
      const result = await this.logIn.execute({
        email: body.email,
        password: body.password,
      });
      if (!result?.success) {
        console.info('[Users][LOGIN] Invalid login');
        return res.status(401).json(result);
      }
      console.info('[Users][LOGIN] Login successful');
      return res.status(200).json(result);
    } catch (error) {
      console.error('[Users][LOGIN] Failed to log in', error);
      return res.status(500).json({ message: 'Unexpected error' });
    }
  }
}
