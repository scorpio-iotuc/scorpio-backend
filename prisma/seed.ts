import { PrismaClient, UserType } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({ adapter });

async function main(): Promise<void> {
  const saltRounds = 12;
  const adminPwd = process.env.ADMIN_PWD;
  if (!adminPwd) {
    throw new Error('ADMIN_PWD is not defined');
  }
  const hashedPassword = await bcrypt.hash(adminPwd, saltRounds);
  const admin = {
    name: 'admin',
    email: 'scorpioiotuc@gmail.com',
    pwd_encrypted: hashedPassword,
    type: UserType.ADMIN,
  };
  // Only create the admin if missing; never reset an existing admin's password on restart
  await prisma.user.upsert({
    where: { email: admin.email },
    update: {
      type: admin.type,
    },
    create: {
      name: admin.name,
      email: admin.email,
      pwd_encrypted: admin.pwd_encrypted,
      type: admin.type,
    },
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });