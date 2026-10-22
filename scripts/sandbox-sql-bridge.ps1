param([Parameter(Mandatory=$true)][string]$Database,[Parameter(Mandatory=$true)][string]$Token,[switch]$Bootstrap)
$ErrorActionPreference='Stop'
if($Database -notmatch '^AgenteSqlSandbox_[a-f0-9]{16}$' -or $Token -notmatch '^[a-f0-9]{64}$'){throw 'SANDBOX_IDENTITY_INVALID'}
$connection=New-Object System.Data.SqlClient.SqlConnection
$connection.ConnectionString="Data Source=(localdb)\AgenteSqlSandbox;Initial Catalog=master;Integrated Security=True;Connect Timeout=15;Application Name=AgenteSqlSandbox"
$connection.Open()
$check=$connection.CreateCommand()
$check.CommandText="SELECT CONVERT(int,SERVERPROPERTY('IsLocalDB'))"
if($check.ExecuteScalar() -ne 1){throw 'LOCALDB_REQUIRED'}
if($Bootstrap){
 $check.CommandText='SELECT COUNT(*) FROM sys.databases WHERE name=@name';[void]$check.Parameters.AddWithValue('@name',$Database)
 if($check.ExecuteScalar() -ne 0){throw 'FRESH_DATABASE_REQUIRED'}
 $check.Parameters.Clear();$check.CommandText="CREATE DATABASE [$Database]";[void]$check.ExecuteNonQuery()
 $connection.ChangeDatabase($Database)
 $check.CommandText='CREATE TABLE dbo.SandboxIdentity(token varchar(64) NOT NULL PRIMARY KEY); INSERT dbo.SandboxIdentity VALUES (@token)';[void]$check.Parameters.AddWithValue('@token',$Token);[void]$check.ExecuteNonQuery()
}else{$connection.ChangeDatabase($Database)}
$transaction=$null
try{
 while($line=[Console]::ReadLine()){
  try{
   $request=$line|ConvertFrom-Json
   $guard=$connection.CreateCommand();$guard.Transaction=$transaction
   $guard.CommandText="SELECT CASE WHEN DB_NAME()=@name AND CONVERT(int,SERVERPROPERTY('IsLocalDB'))=1 AND (SELECT COUNT(*) FROM dbo.SandboxIdentity WHERE token=@token)=1 THEN 1 ELSE 0 END"
   [void]$guard.Parameters.AddWithValue('@name',$Database);[void]$guard.Parameters.AddWithValue('@token',$Token)
   if($guard.ExecuteScalar() -ne 1){throw 'SANDBOX_IDENTITY_MISMATCH'}
   $rows=@()
   switch($request.op){
    'begin' {$transaction=$connection.BeginTransaction([System.Data.IsolationLevel]::Serializable)}
    'commit' {$transaction.Commit();$transaction=$null}
    'rollback' {$transaction.Rollback();$transaction=$null}
    'query' {
     $command=$connection.CreateCommand();$command.Transaction=$transaction;$command.CommandTimeout=30;$command.CommandText=$request.sql
     foreach($property in $request.params.PSObject.Properties){
      if($property.Name -notmatch '^[A-Za-z][A-Za-z0-9_]*$'){throw 'INVALID_PARAMETER'}
      $parameter=$command.Parameters.Add('@'+$property.Name,[System.Data.SqlDbType]::VarChar,512);$parameter.Value=[string]$property.Value
     }
     $reader=$command.ExecuteReader()
     do{
      if($reader.FieldCount -gt 0){
       $rows=@();while($reader.Read()){$row=@{};for($i=0;$i -lt $reader.FieldCount;$i++){$row[$reader.GetName($i)]=if($reader.IsDBNull($i)){$null}else{$reader.GetValue($i)}};$rows+=,$row}
      }
     }while($reader.NextResult())
     $reader.Close()
    }
    default {throw 'INVALID_OPERATION'}
   }
   [Console]::WriteLine((@{ok=$true;rows=@($rows)}|ConvertTo-Json -Compress -Depth 30))
  }catch{[Console]::WriteLine((@{ok=$false;error=$_.Exception.Message}|ConvertTo-Json -Compress -Depth 5))}
 }
}finally{if($transaction){try{$transaction.Rollback()}catch{}};$connection.Close()}
