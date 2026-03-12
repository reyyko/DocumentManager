import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app/app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    cors: true,
  });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

bootstrap();
