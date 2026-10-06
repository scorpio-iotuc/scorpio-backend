import { Request, Response } from 'express';
import { CreateUserDTO } from '../dto/CreateUserDTO';
import { UpdateUserDTO } from '../dto/UpdateUserDTO';
import { UserRepository } from '../repositories/UserRepository';
import { CreateUser } from '../use-cases/CreateUser';
import { DeleteUser } from '../use-cases/DeleteUser';
import { GetUser } from '../use-cases/GetUser';
import { ListUsers } from '../use-cases/ListUsers';
import { UpdateUser } from '../use-cases/UpdateUser';
import { UserType } from '../entities/User';

// Domain errors that are safe to show to the client; anything else gets a generic message
const CLIENT_ERRORS = new Set(['User already exists', 'Email already in use', 'User type cannot be updated']);

const toClientMessage = (error: unknown): string =>
  error instanceof Error && CLIENT_ERRORS.has(error.message)
    ? error.message
    : 'Unexpected error. check the logs for more details';

export class UserController {
  private readonly createUser: CreateUser;
  private readonly getUser: GetUser;
  private readonly listUsers: ListUsers;
  private readonly updateUser: UpdateUser;
  private readonly deleteUser: DeleteUser;

  constructor(userRepository: UserRepository) {
    this.createUser = new CreateUser(userRepository);
    this.getUser = new GetUser(userRepository);
    this.listUsers = new ListUsers(userRepository);
    this.updateUser = new UpdateUser(userRepository);
    this.deleteUser = new DeleteUser(userRepository);
  }

  public static build(userRepository: UserRepository): UserController {
    return new UserController(userRepository);
  }

  create = async (req: Request, res: Response): Promise<Response> => {
    try {
      console.log('[Users][CREATE] Request received');
      if (!req.body || typeof req.body !== 'object') {
        return res.status(400).json({
          message: 'Invalid request body.',
        });
      }
      const payload = req.body as CreateUserDTO;
      if (
        typeof payload.name !== 'string' ||
        typeof payload.email !== 'string' ||
        typeof payload.password !== 'string' ||
        (payload.type !== undefined && !Object.values(UserType).includes(payload.type))
      ) {
        return res.status(400).json({ message: 'Invalid request body.' });
      }
      const createdUser = await this.createUser.execute(payload);

      console.log('[Users][CREATE] User created successfully', { id: createdUser.id });

      return res.status(201).json(createdUser);
    } catch (error) {
      console.error('[Users][CREATE] Failed to create user', error);
      return res.status(400).json({ message: toClientMessage(error) });
    }
  };

  get = async (req: Request, res: Response): Promise<Response> => {
    const id = Number(req.params.id);

    console.log('[Users][GET] Request received', { id: req.params.id });

    if (Number.isNaN(id)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }

    if (req.user?.id !== id && req.user?.type !== UserType.ADMIN) {
      return res.status(403).json({ message: 'You are not allowed to view this user.' });
    }

    const user = await this.getUser.execute(id);

    if (!user) {
      console.log('[Users][GET] User not found', { id });
      return res.status(404).json({ message: 'User not found' });
    }

    console.log('[Users][GET] User found', { id });

    return res.status(200).json(user);
  };

  list = async (_req: Request, res: Response): Promise<Response> => {
    console.log('[Users][LIST] Request received');
    const users = await this.listUsers.execute();

    console.log('[Users][LIST] Users returned', { count: users.length });
    return res.status(200).json(users);
  };

  update = async (req: Request, res: Response): Promise<Response> => {
    const id = Number(req.params.id);

    console.log('[Users][UPDATE] Request received', { id: req.params.id });

    if (Number.isNaN(id)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }
    const user = req.user;
    if (!user) {
      return res.status(404).json({message: 'Forbidden credentials'});
    }
    if (user.id != id && user.type !== UserType.ADMIN) {
      return res.status(404).json({message: 'You are not allowed to update this user.'});
    }
    try {
      const payload = req.body as UpdateUserDTO;

      if (!payload || typeof payload !== 'object') {
        return res.status(400).json({ message: 'Invalid request body.' });
      }

      if (
        (payload.name !== undefined && typeof payload.name !== 'string') ||
        (payload.email !== undefined && typeof payload.email !== 'string') ||
        (payload.password !== undefined && typeof payload.password !== 'string')
      ) {
        return res.status(400).json({ message: 'Invalid request body.' });
      }

      if (payload.type !== undefined) {
        if (!Object.values(UserType).includes(payload.type)) {
          return res.status(400).json({ message: 'Invalid request body.' });
        }

        // Only an admin may change the role, and never their own (avoids self-escalation and self-lockout)
        if (user.type !== UserType.ADMIN || user.id == id) {
          return res.status(400).json({ message: 'User type cannot be updated' });
        }
      }

      const updatedUser = await this.updateUser.execute(id, payload);

      if (!updatedUser) {
        console.log('[Users][UPDATE] User not found', { id });
        return res.status(404).json({ message: 'User not found' });
      }

      console.log('[Users][UPDATE] User updated successfully', { id });

      return res.status(200).json(updatedUser);
    } catch (error) {
      console.error('[Users][UPDATE] Failed to update user', error);
      return res.status(400).json({ message: toClientMessage(error) });
    }
  };

  delete = async (req: Request, res: Response): Promise<Response> => {
    const id = Number(req.params.id);
    const user = req.user;
    if (!user) {
      return res.status(404).json({message: 'Forbidden credentials'});
    }
    if (user.id != id && user.type !== UserType.ADMIN) {
      return res.status(404).json({message: 'You are not allowed to delete this user.'});
    }

    console.log('[Users][DELETE] Request received', { id: req.params.id });

    if (Number.isNaN(id)) {
      return res.status(400).json({ message: 'Invalid user id' });
    }

    const deleted = await this.deleteUser.execute(id);

    if (!deleted) {
      console.log('[Users][DELETE] User not found', { id });
      return res.status(404).json({ message: 'User not found' });
    }

    console.log('[Users][DELETE] User deleted successfully', { id });

    return res.status(204).send();
  };
}