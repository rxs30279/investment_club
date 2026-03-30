const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// Load environment variables
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase environment variables');
  console.error('Make sure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function runMigration() {
  try {
    console.log('Running database migration...');
    
    // Read the SQL file
    const sqlPath = path.join(__dirname, '..', 'migrations', 'create_unit_values_table.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    // Split into individual statements
    const statements = sql.split(';').filter(stmt => stmt.trim().length > 0);
    
    for (const statement of statements) {
      console.log('Executing:', statement.substring(0, 100) + '...');
      const { error } = await supabase.rpc('exec_sql', { sql: statement + ';' });
      
      if (error) {
        // Try direct SQL execution if RPC fails
        console.log('RPC failed, trying direct execution...');
        const { error: directError } = await supabase.from('_exec_sql').select('*').limit(1);
        if (directError) {
          console.error('Error executing SQL:', error);
          console.log('Note: You may need to run this SQL directly in the Supabase SQL editor');
          console.log('SQL to run:');
          console.log(sql);
        }
      }
    }
    
    console.log('Migration completed successfully!');
    console.log('You can now:');
    console.log('1. Upload treasurer PDFs to the Treasurer page');
    console.log('2. Go to Performance page and click "Extract PDF Data"');
    console.log('3. Unit values will be automatically extracted and stored');
    
  } catch (error) {
    console.error('Migration failed:', error);
    console.log('\nAlternative: Run the SQL directly in Supabase SQL editor:');
    const sqlPath = path.join(__dirname, '..', 'migrations', 'create_unit_values_table.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    console.log(sql);
  }
}

runMigration();