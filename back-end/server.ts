import express, { Request, Response, NextFunction } from 'express';
import { runAgent } from './agent';

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.post('/agent', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { message } = req.body;

  if (!message) {
    res.status(400).json({ error: 'Message is required' });
    return;
  }

  try {
    const result = await runAgent(message);
    res.json({
      success: true,
      data: result,
    });
  } catch (err: any) {
    console.error('Agent Error:', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Agent processing failed',
    });
  }
});

// Health check
app.get('/status', (req: Request, res: Response): void => {
  res.status(200).json({ status: 'ok' });
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction): void => {
  console.error('Server Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});