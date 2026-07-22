// @ts-ignore — package subpath types require ESM-aware consumers
import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server';
// @ts-ignore — package subpath types require ESM-aware consumers
import { paymentMiddleware } from '@x402/express';
// @ts-ignore — package subpath types require ESM-aware consumers
import { ExactStellarScheme } from '@x402/stellar/exact/server';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

export interface X402ServeConfig {
    /** Decimal USDC price, for example `"0.02"`. */
    price: string | number;
    /** Stellar account that receives settlement. */
    payTo: string;
    /** CAIP-2 Stellar network identifier. */
    network?: 'stellar:testnet' | 'stellar:pubnet';
    /** x402 facilitator used to verify and settle payments. */
    facilitatorUrl?: string;
    /** Maximum time a signed payment remains valid. */
    maxTimeoutSeconds?: number;
    /** Human-readable description returned with a 402 challenge. */
    description?: string;
}

/** Protect an Express route with a Stellar x402 payment. */
export function x402Serve(config: X402ServeConfig): RequestHandler {
    if (!config.payTo.trim()) {
        throw new Error('x402Serve requires a non-empty payTo address.');
    }

    const numericPrice = typeof config.price === 'number' ? config.price : Number(config.price);
    if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
        throw new Error('x402Serve price must be a positive number.');
    }

    const network = config.network ?? 'stellar:testnet';
    const facilitator = new HTTPFacilitatorClient({
        url: config.facilitatorUrl ?? 'https://facilitator.x402.org',
    });
    const server = new x402ResourceServer(facilitator)
        .register(network, new ExactStellarScheme());
    const handlers = new Map<string, RequestHandler>();

    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        const route = `${req.method.toUpperCase()} ${req.route?.path ?? req.path}`;
        let handler: RequestHandler | undefined = handlers.get(route);

        if (!handler) {
            const createdHandler: RequestHandler = paymentMiddleware(
                {
                    [route]: {
                        accepts: {
                            scheme: 'exact',
                            price: `$${numericPrice}`,
                            network,
                            payTo: config.payTo,
                            maxTimeoutSeconds: config.maxTimeoutSeconds ?? 60,
                        },
                        description: config.description ?? 'Nirium x402 protected resource',
                    },
                },
                server,
            );
            handlers.set(route, createdHandler);
            handler = createdHandler;
        }

        await handler(req, res, next);
    };
}
