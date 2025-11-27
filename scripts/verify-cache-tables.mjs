// Quick script to verify cache tables exist in Supabase
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing Supabase credentials in .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTables() {
    console.log('🔍 Checking cache tables...\n');

    // Check tastedive_cache
    const { data: tastediveData, error: tastediveError } = await supabase
        .from('tastedive_cache')
        .select('count')
        .limit(1);

    if (tastediveError) {
        console.log('❌ tastedive_cache: NOT FOUND');
        console.log('   Error:', tastediveError.message);
    } else {
        console.log('✅ tastedive_cache: EXISTS');
    }

    // Check watchmode_cache
    const { data: watchmodeData, error: watchmodeError } = await supabase
        .from('watchmode_cache')
        .select('count')
        .limit(1);

    if (watchmodeError) {
        console.log('❌ watchmode_cache: NOT FOUND');
        console.log('   Error:', watchmodeError.message);
    } else {
        console.log('✅ watchmode_cache: EXISTS');
    }

    console.log('\n✨ Verification complete!');
}

checkTables().catch(console.error);
