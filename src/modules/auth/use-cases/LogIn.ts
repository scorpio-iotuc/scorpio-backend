
import { UserRepository } from "../../users/repositories/UserRepository";
import { LoginDTO } from "../dto/LoginDTO";
import { LoginResponseDTO } from "../dto/LoginResponseDTO";
import { JwtService } from "../services/JwtService";
import bcrypt from 'bcrypt';

const DUMMY_HASH = bcrypt.hashSync('scorpio-dummy-password', 10);

export class Login {
    private readonly jwtService: JwtService;
    constructor(private readonly userRepository: UserRepository) {
        this.jwtService = new JwtService()
    }

    async execute(data: LoginDTO): Promise<LoginResponseDTO | null> {
        const user = await this.userRepository.findByEmail(data.email);
        // Compare against a dummy hash when the user doesn't exist so response time doesn't reveal valid emails
        const validPwd = await bcrypt.compare(data.password, user?.password ?? DUMMY_HASH);
        if (!user || !validPwd) {
            return {
                success: false,
                message: 'Invalid email or password.',
            };
        }
        const token = this.jwtService.sign({ id: user.id, email: user.email, type: user.type })

        return {
            success: true,
            message: 'Login successful',
            token: token
        }

    }

}