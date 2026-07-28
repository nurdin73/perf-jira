# documentation
## as software engineer
## context
I need a command-line application to retrieve Jira ticket data based on the current user and the current month. The “current month” refers to the month when the ticket status changes to “Todo,” not when the ticket was created. This script only requires the user to select the month and year. The script itself can retrieve data such as the history of when a ticket transitioned from “In Progress” to “Done.” For each task, there will be a summary showing only the number of days required to move from “In Progress” to “Done.” Additionally, the script displays the total story points. Furthermore, the script displays the lead time for each task—how many days it takes from “In Progress” to “Done”—and then sums up the lead times for all retrieved tasks to calculate the average lead time. I’d like all this task data to be exported to a CSV file, which should include only the link, title, start date (“In Progress”), end date (“Done”), and lead time. 

## expected response
### summary
### sequence
### requirement
### how to use