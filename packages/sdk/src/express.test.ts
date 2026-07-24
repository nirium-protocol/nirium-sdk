const paymentMiddleware = jest.fn();
const register = jest.fn();

jest.mock('@x402/express', () => ({ paymentMiddleware }));
jest.mock('@x402/core/server', () => ({
    HTTPFacilitatorClient: jest.fn((config) => ({ config })),
    x402ResourceServer: jest.fn(() => ({ register })),
}));
jest.mock('@x402/stellar/exact/server', () => ({
    ExactStellarScheme: jest.fn(),
}));

import { x402Serve } from './express';

describe('x402Serve', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        register.mockReturnValue({ register });
    });

    it('returns 402 for a request without a valid payment signature', async () => {
        paymentMiddleware.mockImplementation(() => async (req: any, res: any, next: any) => {
            if (!req.headers['x-payment']) {
                res.status(402).json({ error: 'Payment Required' });
                return;
            }
            next();
        });

        const middleware = x402Serve({ price: '0.02', payTo: 'GDESTINATION' });
        const req = { method: 'GET', path: '/premium', route: { path: '/premium' }, headers: {} } as any;
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as any;
        const next = jest.fn();

        await middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(402);
        expect(next).not.toHaveBeenCalled();
        expect(paymentMiddleware).toHaveBeenCalledWith(
            {
                'GET /premium': {
                    accepts: {
                        scheme: 'exact',
                        price: '$0.02',
                        network: 'stellar:testnet',
                        payTo: 'GDESTINATION',
                        maxTimeoutSeconds: 60,
                    },
                    description: 'Nirium x402 protected resource',
                },
            },
            expect.anything(),
        );
    });

    it('continues after the protocol middleware verifies the payment', async () => {
        paymentMiddleware.mockImplementation(() => async (_req: any, _res: any, next: any) => next());
        const middleware = x402Serve({ price: 0.05, payTo: 'GDESTINATION', network: 'stellar:pubnet' });
        const next = jest.fn();

        await middleware(
            { method: 'POST', path: '/report', route: { path: '/report' }, headers: { 'x-payment': 'signed' } } as any,
            {} as any,
            next,
        );

        expect(next).toHaveBeenCalledTimes(1);
        expect(register).toHaveBeenCalledWith('stellar:pubnet', expect.anything());
    });

    it.each([
        { price: '0', payTo: 'GDESTINATION' },
        { price: 'invalid', payTo: 'GDESTINATION' },
        { price: '0.02', payTo: '   ' },
    ])('rejects invalid configuration: %o', (config) => {
        expect(() => x402Serve(config)).toThrow();
    });
});
