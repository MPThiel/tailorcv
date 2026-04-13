const supabase = require('./supabase');

async function getAllJobs() {
  const { data, error } = await supabase.from('jobs').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

async function getJobById(id) {
  const { data, error } = await supabase.from('jobs').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

async function createJob(job) {
  const { data, error } = await supabase.from('jobs').insert([job]).select().single();
  if (error) throw error;
  return data;
}

async function updateJob(id, updates) {
  const { data, error } = await supabase.from('jobs').update(updates).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

async function deleteJob(id) {
  const { error } = await supabase.from('jobs').delete().eq('id', id);
  if (error) throw error;
}

module.exports = { getAllJobs, getJobById, createJob, updateJob, deleteJob };
