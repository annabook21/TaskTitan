// Query the database directly via AWS RDS to check constraints
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function checkConstraints() {
  const secretCmd = `aws secretsmanager get-secret-value --secret-id DatabaseClusterSecretD1FB63-bQfkdz5xJ54p --region us-west-2 --query SecretString --output text`;
  
  try {
    const { stdout } = await execAsync(secretCmd);
    const secret = JSON.parse(stdout);
    
    console.log('Checking Project foreign key constraints...');
    
    // Use psql to query constraints
    const query = `
      SELECT 
        con.conname AS constraint_name,
        con.confdeltype AS delete_action
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      WHERE nsp.nspname = 'public'
        AND rel.relname = 'Project'
        AND con.contype = 'f';
    `;
    
    const psqlCmd = `PGPASSWORD='${secret.password}' psql -h ${secret.host} -p ${secret.port} -U ${secret.username} -d ${secret.dbname} -c "${query.replace(/\n/g, ' ')}"`;
    
    const { stdout: result } = await execAsync(psqlCmd);
    console.log(result);
    
    console.log('\nDelete action codes:');
    console.log('a = NO ACTION, r = RESTRICT, c = CASCADE, n = SET NULL, d = SET DEFAULT');
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

checkConstraints();
