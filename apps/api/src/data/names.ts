/** Synthetic name pools. No real candidate data is used anywhere in this POC. */

export const FIRST_NAMES = [
  'Aarav', 'Aditi', 'Ananya', 'Arjun', 'Ayesha', 'Bhavana', 'Chetan', 'Damini', 'Devansh', 'Divya',
  'Farhan', 'Gaurav', 'Harini', 'Imran', 'Ishita', 'Jatin', 'Kabir', 'Kavya', 'Lakshmi', 'Manish',
  'Meera', 'Naveen', 'Nisha', 'Omkar', 'Pooja', 'Pranav', 'Rahul', 'Rhea', 'Rohit', 'Sanya',
  'Shreya', 'Siddharth', 'Tanvi', 'Uday', 'Varun', 'Vidya', 'Yash', 'Zara', 'Neha', 'Karan',
  'Ritika', 'Sameer', 'Nandini', 'Vikram', 'Anjali', 'Rajesh', 'Preeti', 'Suresh', 'Deepa', 'Alok',
];

export const LAST_NAMES = [
  'Sharma', 'Verma', 'Iyer', 'Nair', 'Reddy', 'Patel', 'Singh', 'Gupta', 'Mehta', 'Chopra',
  'Banerjee', 'Das', 'Kulkarni', 'Joshi', 'Rao', 'Menon', 'Bhat', 'Kapoor', 'Malhotra', 'Sinha',
  'Pillai', 'Desai', 'Ghosh', 'Chauhan', 'Trivedi', 'Naidu', 'Saxena', 'Bose', 'Mishra', 'Agarwal',
];

export function syntheticName(index: number): string {
  const first = FIRST_NAMES[index % FIRST_NAMES.length];
  const last = LAST_NAMES[Math.floor(index / FIRST_NAMES.length) % LAST_NAMES.length];
  return `${first} ${last}`;
}
