# Unit Value Tracking System

## Overview
This system automatically extracts unit values from treasurer PDF reports to track the true performance of the investment club, accounting for member subscriptions, withdrawals, and investment returns.

## Why Unit Values Matter
- **Portfolio value alone is misleading** due to member churn (people joining/leaving)
- **Unit values show true performance** by tracking the value of each member's share
- **Accurate benchmarking** against FTSE 100 and other indices
- **Fair member accounting** for subscriptions and withdrawals

## How It Works

### 1. PDF Upload
- Treasurer uploads monthly reports as PDFs to the Treasurer page
- PDFs are stored in Supabase Storage

### 2. Automatic Extraction
- System scans PDFs for financial data patterns:
  - Unit value / price per unit
  - Total assets under management
  - Total units issued
  - Valuation date
- Uses pattern matching and text extraction algorithms

### 3. Data Storage
- Extracted data stored in `unit_values` table
- Linked to original PDF reports
- Confidence scores indicate extraction reliability

### 4. Performance Calculation
- Monthly returns calculated from unit value changes
- Annualized returns for comparison
- Best/worst month identification
- Total growth tracking

## Setup Instructions

### 1. Database Migration
Run the migration to create the necessary tables:

```bash
# Install dependencies
npm install dotenv @supabase/supabase-js

# Run migration
node scripts/run-migration.js
```

Or run the SQL directly in Supabase SQL editor:
```sql
-- See migrations/create_unit_values_table.sql
```

### 2. Environment Variables
Ensure these are in your `.env.local`:
```env
NEXT_PUBLIC_SUPABASE_URL=your_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key  # For migrations
```

### 3. PDF Upload
1. Go to Treasurer page
2. Click "Upload Report"
3. Upload monthly treasurer PDFs
4. Add titles and dates

### 4. Data Extraction
1. Go to Performance page
2. Click "Extract PDF Data" button
3. System will process all PDFs
4. Review extracted data

### 5. Manual Correction (if needed)
1. Click "Manual Entry" button
2. Select report from dropdown
3. Enter correct unit value
4. Save to override automatic extraction

## Features

### Automatic PDF Processing
- Scans for common financial terms
- Multiple date format recognition
- Currency amount extraction
- Confidence scoring

### Performance Metrics
- **Current Unit Value**: Latest extracted value
- **Total Growth**: Since first recorded value
- **Annualized Return**: Compounded annual rate
- **Monthly Returns**: Detailed monthly performance
- **Best/Worst Months**: Performance extremes

### Data Management
- **Manual Override**: Correct extraction errors
- **Confidence Scores**: See extraction reliability
- **Source Tracking**: Link to original PDFs
- **Historical Data**: Track changes over time

## PDF Format Recommendations

For best extraction results, treasurer PDFs should include:

1. **Clear Date**: "Valuation Date: 2025-01-31" or similar
2. **Unit Value**: "Unit Value: £105.50" or "Price per unit: £105.50"
3. **Total Assets**: "Total Assets: £12,500.00" or "AUM: £12,500"
4. **Total Units**: "Total Units: 100" or "Units in issue: 100"

Example format:
```
MESI Investment Club
Monthly Treasurer Report
Date: January 31, 2025

Unit Value: £105.50
Total Assets: £12,500.00
Total Units: 118.5
```

## Troubleshooting

### Extraction Fails
1. Check PDF is text-based (not scanned image)
2. Verify financial terms are present
3. Try manual entry as fallback

### Low Confidence Scores
1. PDF may use unusual formatting
2. Consider standardizing report format
3. Use manual entry for critical values

### Database Errors
1. Run migration SQL directly
2. Check Supabase permissions
3. Verify environment variables

## Best Practices

1. **Standardize Reports**: Use consistent format each month
2. **Regular Updates**: Process PDFs monthly
3. **Review Data**: Check extraction results
4. **Manual Backup**: Keep spreadsheet of unit values
5. **Historical Data**: Add past reports starting Jan 2025

## API Endpoints

- `GET /api/unit-values` - Get all unit values
- `GET /api/unit-values/process` - Process PDFs and extract data
- `POST /api/unit-values/process` - Manually update unit value
- `GET /api/treasurer/extract` - Get treasurer reports list

## Future Enhancements

1. **OCR Support**: Handle scanned PDFs
2. **Email Integration**: Auto-process emailed reports
3. **Chart Visualization**: Interactive unit value charts
4. **Member Portal**: Individual member statements
5. **Automated Alerts**: Performance threshold notifications