import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    // Sanitize id to prevent directory traversal
    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '');
    const contentDir = path.join(process.cwd(), 'features', 'wiki', 'content', 'content');
    const filePath = path.join(contentDir, `${safeId}.md`);

    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ success: false, error: 'Article not found' }, { status: 404 });
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    return NextResponse.json({
      success: true,
      id: safeId,
      content,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
