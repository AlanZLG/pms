import { Router } from 'express'
import { z } from 'zod'
import { templateRepo } from '../repository/repo.ts'
import { authRequired, type AuthRequest } from '../lib/auth.ts'

export const router = Router()
router.use(authRequired)

const createSchema = z.object({
  name: z.string().min(1, '模板名称必填').max(50),
  title: z.string().min(1, '任务标题必填').max(120),
  description: z.string().max(2000).optional().default(''),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional().default('medium'),
  labels: z.array(z.string()).optional().default([]),
})

router.get('/', (req: AuthRequest, res) => {
  const templates = templateRepo.findAll()
  res.json({ templates })
})

router.post('/', (req: AuthRequest, res) => {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message })
    return
  }
  const template = templateRepo.create(parsed.data as { name: string; title: string; description: string; priority: string; labels: string[] })
  res.status(201).json({ template })
})

router.delete('/:id', (req: AuthRequest, res) => {
  templateRepo.delete(req.params.id)
  res.json({ ok: true })
})
