import { UpdateUserDTO } from '../dto/UpdateUserDTO';
import { User } from '../entities/User';
import { UserRepository } from '../repositories/UserRepository';

export class UpdateUser {
  constructor(private readonly userRepository: UserRepository) {}

  async execute(id: number, data: UpdateUserDTO): Promise<User | null> {
    const existingUser = await this.userRepository.findById(id);

    if (!existingUser) {
      return null;
    }

    if (data.email && data.email !== existingUser.email) {
      const userWithSameEmail = await this.userRepository.findByEmail(data.email);

      if (userWithSameEmail) {
        throw new Error('Email already in use');
      }
    }

    return this.userRepository.update(id, data);
  }
}