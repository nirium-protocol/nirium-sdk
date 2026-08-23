FROM php:8.2-cli
RUN apt-get update && apt-get install -y git unzip libgmp-dev
# Install bcmath and gmp extensions
RUN docker-php-ext-install bcmath gmp
# Install Composer
COPY --from=composer:latest /usr/bin/composer /usr/bin/composer
WORKDIR /app
