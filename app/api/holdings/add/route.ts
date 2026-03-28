import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// Define the structure of a holding
interface Holding {
  id: number;
  name: string;
  ticker: string;
  sector: string;
}

interface HoldingsData {
  holdings: Holding[];
}

const holdingsFilePath = path.join(process.cwd(), 'app', 'data', 'holdings-reference.json');

export async function GET() {
  try {
    // Read holdings from JSON file
    const fileContent = fs.readFileSync(holdingsFilePath, 'utf8');
    const holdingsData: HoldingsData = JSON.parse(fileContent);
    
    return NextResponse.json(holdingsData.holdings);
  } catch (error) {
    console.error('Error reading holdings:', error);
    return NextResponse.json({ error: 'Failed to read holdings' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const newHolding: Holding = await request.json();
    
    // Read current holdings
    const fileContent = fs.readFileSync(holdingsFilePath, 'utf8');
    const holdingsData: HoldingsData = JSON.parse(fileContent);
    
    // Check if holding already exists
    const exists = holdingsData.holdings.some((h: Holding) => h.id === newHolding.id);
    if (exists) {
      return NextResponse.json({ success: true, message: 'Holding already exists' });
    }
    
    // Add new holding
    holdingsData.holdings.push(newHolding);
    
    // Write back to file
    fs.writeFileSync(holdingsFilePath, JSON.stringify(holdingsData, null, 2));
    
    console.log(`✅ Added new holding: ${newHolding.name} (${newHolding.ticker})`);
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error saving holding:', error);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}