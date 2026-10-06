import { UserRepository } from "../../users/repositories/UserRepository";
import { SignUpDTO } from "../dto/SignUpDTO";
import { SignUpResponseDTO } from "../dto/SignUpResponseDTO";
import { UserType } from "../../users/entities/User";


export class SignUp {
    constructor(private readonly userRepository: UserRepository) { }
    
    async execute(data: SignUpDTO): Promise<SignUpResponseDTO | null> {
        const existingUser = await this.userRepository.findByEmail(data.email);
        if (existingUser) {
            return null;
        }
        const user = await this.userRepository.create({
            name: data.name,
            email: data.email,
            password: data.password,
            type: UserType.NORMAL,
        })
        return {
            id: user.id,
            name: user.name,
            email: user.email
        }
    }

}